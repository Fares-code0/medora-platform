import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { AllowEndedSession } from '../../../common/auth/allow-ended-session.decorator';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { Authenticated } from '../../../shared/authz';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { Public } from '../../../common/auth/public.decorator';
import { AppException } from '../../../common/errors/app.exception';
import { ConfigService } from '../../../config';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { RateLimited } from '../../../shared/rate-limit';
import {
  forgotPasswordSchema,
  loginSchema,
  otpRecoverySchema,
  otpResendSchema,
  otpVerifySchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from '../dto';
import { isMobileClient } from '../http/client-type';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie } from '../http/refresh-cookie';
import { RefreshService } from '../services/refresh.service';
import { EmailVerificationService } from '../services/email-verification.service';
import { PasswordRecoveryService } from '../services/password-recovery.service';
import { StepUpService } from '../services/step-up.service';
import {
  type AuthenticatedPayload,
  LoginService,
  type RequestContext,
  type SessionUserPayload,
} from '../services/login.service';
import { RegistrationService, type RegisterResult } from '../services/registration.service';
import { SessionUserService } from '../services/session-user.service';

/**
 * The authentication lifecycle (RM M6, API §1).
 *
 * Every route here is `@Public()` except two — `GET /auth/session` and
 * `POST /auth/logout`, which need a session to describe and to end, and
 * so carry `@Authenticated()`. The rest are how a caller *becomes*
 * authenticated, so requiring a token would make them unreachable. The
 * marker is explicit rather than implied by the path prefix, because the
 * same controller grows authenticated routes as the milestones proceed —
 * it has twice now — and "public" being a property of the route rather
 * than of the folder is what keeps that from going wrong.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly registration: RegistrationService,
    private readonly login: LoginService,
    private readonly refreshFlow: RefreshService,
    private readonly stepUp: StepUpService,
    private readonly recovery: PasswordRecoveryService,
    private readonly emailVerification: EmailVerificationService,
    private readonly sessionUser: SessionUserService,
    private readonly config: ConfigService,
  ) {}

  /**
   * API §1.11 / RM M8.1 — **200** `{ data: SessionUser }`.
   *
   * The "who am I" route. `AuthProvider` calls it after a silent refresh
   * to fill the shell's header and to seed `useCan()`, and the mobile
   * client calls it on resume.
   *
   * Declared first among the routes so a reader meets the authenticated
   * one before the seven public ones; the router does not care, but the
   * marker being `@Authenticated()` rather than `@Public()` is the single
   * most important line in this file to read correctly.
   */
  @Authenticated()
  @Get('session')
  session(@CurrentUser() user: AuthenticatedUser): Promise<SessionUserPayload> {
    return this.sessionUser.current(user);
  }

  /**
   * API §1.1 — **201** `{ data: { nextStep, email } }`.
   *
   * The response deliberately carries no session: the account exists but
   * cannot sign in until the address is verified (M6.2 blocks it), and
   * `nextStep` is what `SignupPage` routes on.
   */
  @Public()
  @RateLimited('auth')
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(
    @Body(zodBody(registerSchema)) body: ReturnType<typeof registerSchema.parse>,
    @Req() request: Request,
  ): Promise<RegisterResult> {
    return this.registration.register(body, clientIp(request));
  }

  /**
   * API §1.2 — **200**, one of two shapes.
   *
   * A completed sign-in returns `{ user, accessToken, expiresIn }` and
   * sets the refresh cookie. An account with a second factor returns
   * `{ requiresOtp: true, otpToken }` and sets **no cookie**: the
   * password was right, but there is no session yet, and a cookie here
   * would be a session by another name.
   *
   * `passthrough: true` so the handler still returns its body through
   * the envelope interceptor while touching the response for the cookie
   * — taking the raw response and writing to it directly would bypass
   * `{ data: … }` and break every client (API §0.2).
   */
  @Public()
  @RateLimited('auth')
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body(zodBody(loginSchema)) body: ReturnType<typeof loginSchema.parse>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<
    AuthenticatedPayload | MobileAuthenticatedPayload | { requiresOtp: true; otpToken: string }
  > {
    const outcome = await this.login.login(body, requestContext(request));

    // No session yet, so no refresh token to deliver either way. The
    // `otpToken` is the only credential this branch issues.
    if (outcome.kind === 'otp') return outcome.payload;

    return deliverRefreshToken(
      request,
      response,
      outcome.payload,
      outcome.refreshToken,
      outcome.refreshTtlSeconds,
      this.config.env.COOKIE_DOMAIN,
    );
  }

  /**
   * API §1.3 — completes a suspended sign-in.
   *
   * The success payload is byte-identical to `/auth/login`'s, and the
   * cookie is set here for the first time: this is where the session
   * begins for a user with a second factor.
   */
  @Public()
  @RateLimited('auth')
  @Post('otp/verify')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Body(zodBody(otpVerifySchema)) body: ReturnType<typeof otpVerifySchema.parse>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedPayload | MobileAuthenticatedPayload> {
    const outcome = await this.stepUp.verify(body.otpToken, body.code, requestContext(request));

    return deliverRefreshToken(
      request,
      response,
      outcome.payload,
      outcome.refreshToken,
      outcome.refreshTtlSeconds,
      this.config.env.COOKIE_DOMAIN,
    );
  }

  /**
   * Owner decision R1 — completes a suspended sign-in with a single-use
   * recovery code instead of the six digits. Same challenge, same attempt
   * bound, same success payload and cookie as `/otp/verify`. See
   * `StepUpService.redeemRecoveryCode`.
   */
  @Public()
  @RateLimited('auth')
  @Post('otp/recovery')
  @HttpCode(HttpStatus.OK)
  async redeemRecoveryCode(
    @Body(zodBody(otpRecoverySchema)) body: ReturnType<typeof otpRecoverySchema.parse>,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedPayload | MobileAuthenticatedPayload> {
    const outcome = await this.stepUp.redeemRecoveryCode(
      body.otpToken,
      body.recoveryCode,
      requestContext(request),
    );

    return deliverRefreshToken(
      request,
      response,
      outcome.payload,
      outcome.refreshToken,
      outcome.refreshTtlSeconds,
      this.config.env.COOKIE_DOMAIN,
    );
  }

  /**
   * API §1.4 — 204, rate-limited.
   *
   * With an authenticator app there is nothing to send again; what the
   * button actually buys is more time, and that is what this gives. See
   * `StepUpService.resend`.
   */
  @Public()
  @RateLimited('auth')
  @Post('otp/resend')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resendOtp(
    @Body(zodBody(otpResendSchema)) body: ReturnType<typeof otpResendSchema.parse>,
  ): Promise<void> {
    await this.stepUp.resend(body.otpToken);
  }

  /**
   * API §1.5 — rotates the cookie and returns a fresh access token.
   *
   * `@Public()` because the caller has no access token: this endpoint is
   * how they get one. The refresh cookie is the credential, and the
   * `Path=/api/v1/auth` scoping is why it is attached to this request and
   * not to every clinical one.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<AuthenticatedPayload | MobileAuthenticatedPayload> {
    const presented = presentedRefreshToken(request);
    // No cookie at all is the same 401 as a bad one. The client's next
    // move — hard log out — is identical, and answering differently would
    // let a caller probe whether a cookie was accepted.
    if (presented === undefined) throw AppException.unauthorized('unauthorized', 'Session expired');

    const result = await this.refreshFlow.refresh(presented, requestContext(request));

    return deliverRefreshToken(
      request,
      response,
      result.payload,
      result.refreshToken,
      result.ttlSeconds,
      this.config.env.COOKIE_DOMAIN,
    );
  }

  /**
   * API §1.7 — **always 202** `{ accepted: true }`.
   *
   * For a real address, an unknown one, a deactivated account and one
   * whose cooldown has not elapsed. The endpoint is unauthenticated, so
   * any difference — body, status or timing — turns it into a way of
   * asking whether someone has an account here, which in a clinic is a
   * question about employment rather than about software.
   */
  @Public()
  @RateLimited('auth')
  @Post('forgot-password')
  @HttpCode(HttpStatus.ACCEPTED)
  async forgotPassword(
    @Body(zodBody(forgotPasswordSchema)) body: ReturnType<typeof forgotPasswordSchema.parse>,
  ): Promise<{ accepted: true }> {
    await this.recovery.forgot(body.email);
    return { accepted: true };
  }

  /** API §1.8 — 204. Single-use token, policy checked, all sessions revoked. */
  @Public()
  @RateLimited('auth')
  @Post('reset-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(
    @Body(zodBody(resetPasswordSchema)) body: ReturnType<typeof resetPasswordSchema.parse>,
    @Req() request: Request,
  ): Promise<void> {
    await this.recovery.reset(body.token, body.password, clientIp(request));
  }

  /** API §1.9 — 204, or 422 `token_invalid`. Unblocks sign-in. */
  @Public()
  @RateLimited('auth')
  @Post('verify-email')
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyEmail(
    @Body(zodBody(verifyEmailSchema)) body: ReturnType<typeof verifyEmailSchema.parse>,
    @Req() request: Request,
  ): Promise<void> {
    await this.emailVerification.verify(body.token, clientIp(request));
  }

  /**
   * API §1.10 — 202, rate-limited.
   *
   * 202 rather than 204 for the same reason `forgot-password` is: the
   * answer must not depend on whether the address has an account, so it
   * cannot be "created" or "done" — only "accepted".
   */
  @Public()
  @RateLimited('auth')
  @Post('verification/resend')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(
    @Body(zodBody(resendVerificationSchema))
    body: ReturnType<typeof resendVerificationSchema.parse>,
  ): Promise<{ accepted: true }> {
    await this.emailVerification.resend(body.email);
    return { accepted: true };
  }

  /**
   * API §1.6 — **204**, session revoked and cookie cleared.
   *
   * Guarded: the access token names the session to revoke, so a logout
   * cannot end someone else's. The cookie is cleared whatever else
   * happens — a client left holding a refresh token after logging out is
   * the one outcome this endpoint exists to prevent.
   *
   * `@AllowEndedSession()` keeps that true for a session already ended
   * elsewhere (PRE-01): the guard still verifies the signature, but does
   * not refuse the token because its session is revoked, so the client
   * is still told to drop its cookie.
   */
  @Authenticated()
  @AllowEndedSession()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    try {
      await this.refreshFlow.logout(user, requestContext(request));
    } finally {
      clearRefreshCookie(response, this.config.env.COOKIE_DOMAIN);
    }
  }
}

/**
 * Where this client's refresh token is delivered (MG §15.2, ADR-014).
 *
 * Four routes mint a refresh token — login, OTP verify, recovery-code
 * redemption and refresh — and all four must deliver it the same way, or a mobile client that
 * can log in cannot rotate, and one that can rotate cannot recover from
 * a cold start. Hence one helper rather than three call sites that agree
 * today.
 *
 * **Exactly one copy is issued.** A web client gets the `httpOnly`
 * cookie and no body token; a mobile client gets the body token and no
 * cookie. Doing both for mobile would leave a 30-day credential in a
 * cookie jar the client never reads and cannot clear on logout — a live
 * token nobody is managing, which is worse than either single mechanism.
 * MG §15.2 says "instead of a cookie", and this is what that means.
 *
 * Web behaviour is byte-identical to before: without the header, the
 * response body gains nothing and the cookie is set exactly as it was.
 */
function deliverRefreshToken(
  request: Request,
  response: Response,
  payload: AuthenticatedPayload,
  refreshToken: string,
  ttlSeconds: number,
  cookieDomain: string,
): AuthenticatedPayload | MobileAuthenticatedPayload {
  if (isMobileClient(request)) return { ...payload, refreshToken };

  setRefreshCookie(response, refreshToken, ttlSeconds, cookieDomain);
  return payload;
}

/**
 * The login/refresh payload with the token a native client has nowhere
 * else to get. Additive: the web shape is unchanged and no existing
 * client sees this field.
 */
export interface MobileAuthenticatedPayload extends AuthenticatedPayload {
  readonly refreshToken: string;
}

/**
 * The refresh token, from the cookie or — for a mobile client — the body.
 *
 * API §1.5: "with `X-Client-Type: mobile`, refresh token travels in body
 * instead of cookie". A native client has no cookie jar scoped to a web
 * origin, so the cookie mechanism has nothing to hold it.
 *
 * The header is a *fallback selector*, not an override: the cookie wins
 * whenever one is present, so a browser cannot be talked into sending its
 * token in a body by an attacker who controls a header. ADR-014 assigns
 * `X-Client-Type` to the backend; M41 validates the mobile path.
 */
function presentedRefreshToken(request: Request): string | undefined {
  const cookie = readRefreshCookie(request);
  if (cookie !== undefined) return cookie;

  if (!isMobileClient(request)) return undefined;

  const body: unknown = request.body;
  if (typeof body !== 'object' || body === null) return undefined;

  const token = (body as Record<string, unknown>)['refreshToken'];
  return typeof token === 'string' && token.length > 0 ? token : undefined;
}

/**
 * The device and address recorded against a sign-in attempt.
 *
 * The User-Agent is stored raw and truncated to the column width (DB
 * §A7/§A9 both cap it at 120). Parsing it into "Chrome on macOS" is the
 * job of whatever renders M8.5's history: a parser here would bake one
 * presentation into the stored row, and the raw string is the only
 * version that can be re-read when the parser turns out to be wrong.
 */
function requestContext(request: Request): RequestContext {
  const userAgent = request.headers['user-agent'];

  return {
    ipAddress: clientIp(request),
    device: userAgent === undefined ? undefined : userAgent.slice(0, 120),
  };
}

/**
 * The caller's address, for the audit actor and `login_events`.
 *
 * `req.ip` respects Express's `trust proxy` setting, which M37 configures
 * for the real deployment. Until then it is the socket address, which is
 * correct in development and behind a proxy is the proxy's — recorded
 * rather than guessed at, so nothing here has to be revisited when the
 * setting lands.
 */
export function clientIp(request: Request): string | undefined {
  return request.ip;
}

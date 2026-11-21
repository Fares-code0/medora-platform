/**
 * Boundary fixture (RM M2.2) — **this file must pass lint.**
 *
 * The control. A rule list that rejects everything would satisfy the
 * five negative fixtures and make the codebase unbuildable, so one
 * fixture asserts the permitted imports stay permitted: `common/`, and
 * `config/` and the shared kernel through their public indexes — the
 * exact list RM M2.2 allows a module to import.
 */
import { AppException } from '../../../common/errors/app.exception';
import { ConfigService } from '../../../config';
import { AUDIT_DISPATCHER } from '../../../shared/audit';
import { Can, ROLE_REPOSITORY } from '../../../shared/authz';
import { maskMrn } from '../../../shared/phi';
import { defineStatusMachine } from '../../../shared/status';

export const allowed = [
  AppException.name,
  ConfigService.name,
  AUDIT_DISPATCHER.toString(),
  ROLE_REPOSITORY.toString(),
  typeof Can,
  typeof maskMrn,
  typeof defineStatusMachine,
];

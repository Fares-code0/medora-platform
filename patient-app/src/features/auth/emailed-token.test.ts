import { extractEmailedToken } from './emailed-token';

/** What a pasted reset link or code becomes before it is sent (S4). */
describe('extractEmailedToken', () => {
  it.each([
    ['a bare token', 'RESET-abc_123', 'RESET-abc_123'],
    ['a bare token with whitespace', '  RESET-abc_123\n', 'RESET-abc_123'],
    ['the emailed link', 'https://app.medora.example/reset-password?token=T1', 'T1'],
    [
      'a sentence around the link',
      'Here is the link https://app.medora.example/reset-password?token=T1 thanks',
      'T1',
    ],
    ['an upper-case parameter name', 'https://x.example/reset-password?TOKEN=T1', 'T1'],
    ['an empty token before a real one', 'https://x.example/reset-password?token=&token=T1', 'T1'],
    ['a percent-encoded token', 'https://x.example/reset-password?token=T%5F1', 'T_1'],
  ])('reads %s', (_label, pasted, expected) => {
    expect(extractEmailedToken(pasted)).toBe(expected);
  });

  it.each([
    ['a tokenless link', 'https://app.medora.example/reset-password'],
    ['a sentence with a tokenless link', 'Here is the link https://x.example/reset-password'],
    ['a sentence with a www link', 'see www.medora.example/reset-password please'],
    ['an empty token', 'https://x.example/reset-password?token='],
    ['an empty parameter alone', 'token='],
    ['a malformed escape', 'https://x.example/reset-password?token=%E0%A4%A'],
    ['whitespace only', '   '],
  ])('yields nothing for %s, so the form asks for the code', (_label, pasted) => {
    expect(extractEmailedToken(pasted)).toBe('');
  });
});

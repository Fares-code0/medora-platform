import { parseEnv } from '@/configs/env';

import { UNCONFIGURED_EMERGENCY } from './model/types';
import { configurationFrom } from './service';

/**
 * N-04: the operator's build-time emergency list. The app never supplies
 * a number of its own, so the unset case must stay UNCONFIGURED, and a
 * malformed list must fail at boot rather than dial a wrong line.
 */
const base = { EXPO_PUBLIC_APP_ENV: 'development' };

describe('EXPO_PUBLIC_EMERGENCY_NUMBERS', () => {
  it('is empty when unset or blank, so the screen stays unconfigured', () => {
    expect(parseEnv(base).emergencyNumbers).toEqual([]);
    expect(parseEnv({ ...base, EXPO_PUBLIC_EMERGENCY_NUMBERS: '  ' }).emergencyNumbers).toEqual([]);
    expect(configurationFrom([])).toBe(UNCONFIGURED_EMERGENCY);
  });

  it('parses a valid list and maps it to an operator configuration, verbatim', () => {
    const list = [
      { id: 'ambulance', label: 'Ambulance / الإسعاف', number: '+12345', region: 'XX' },
      { id: 'poison', label: 'Poison line', number: '1234', whenToUse: 'Swallowed something' },
    ];
    const parsed = parseEnv({ ...base, EXPO_PUBLIC_EMERGENCY_NUMBERS: JSON.stringify(list) });
    const config = configurationFrom(parsed.emergencyNumbers);
    expect(config.source).toBe('operator');
    expect(config.clinic).toBeNull();
    expect(config.numbers).toEqual(list);
  });

  it.each([
    ['not JSON', 'ambulance=997'],
    ['not an array', '{"id":"a","label":"A","number":"997"}'],
    ['letters in the number', '[{"id":"a","label":"A","number":"99x"}]'],
    ['a one-digit number', '[{"id":"a","label":"A","number":"9"}]'],
    ['an empty label', '[{"id":"a","label":" ","number":"997"}]'],
    [
      'duplicate ids',
      '[{"id":"a","label":"A","number":"997"},{"id":"a","label":"B","number":"998"}]',
    ],
    ['an unknown field', '[{"id":"a","label":"A","number":"997","url":"tel:997"}]'],
    [
      'more than six entries',
      JSON.stringify(
        Array.from({ length: 7 }, (_, i) => ({ id: `n${i}`, label: 'X', number: '99' + i })),
      ),
    ],
  ])('refuses %s at boot', (_case, raw) => {
    expect(() => parseEnv({ ...base, EXPO_PUBLIC_EMERGENCY_NUMBERS: raw })).toThrow(
      /EXPO_PUBLIC_EMERGENCY_NUMBERS/,
    );
  });
});

import { createElement } from 'react';

import { render } from '@testing-library/react-native';
import { AccessibilityInfo, Platform, View, type HostInstance } from 'react-native';

import { announce, decorative, focusOn, headingA11y, labelWithHint, pressableA11y } from './a11y';

/**
 * The accessibility floor — checklist S-02, S-07.
 *
 * `a11y.ts` was at 50% of statements, which is the wrong number for the
 * module every control in this app takes its props through. It is not a
 * helper file in the usual sense: `pressableA11y` is what makes a label
 * *required by the signature*, and the three functions under it are the
 * only places this tree touches the platform's assistive APIs. A
 * regression in any of them is silent — the app renders, and a screen
 * reader stops saying something.
 */

describe('pressableA11y makes the omission impossible', () => {
  it('always sets a role, defaulting to button', () => {
    expect(pressableA11y({ label: 'Book' })).toMatchObject({
      accessible: true,
      accessibilityRole: 'button',
      accessibilityLabel: 'Book',
    });
    expect(pressableA11y({ label: 'Upcoming', role: 'tab' }).accessibilityRole).toBe('tab');
  });

  it('omits the hint rather than setting it to undefined', () => {
    // A key present with an undefined value is not the same as an absent
    // key to a native prop bridge, and "hint: undefined" is read by some
    // versions as an empty hint.
    expect('accessibilityHint' in pressableA11y({ label: 'Book' })).toBe(false);
    expect(pressableA11y({ label: 'Book', hint: 'Opens booking' }).accessibilityHint).toBe(
      'Opens booking',
    );
  });

  it('states disabled and busy explicitly, because absent is not false', () => {
    expect(pressableA11y({ label: 'Book' }).accessibilityState).toEqual({
      disabled: false,
      busy: false,
    });
    expect(pressableA11y({ label: 'Book', disabled: true, busy: true }).accessibilityState).toEqual(
      {
        disabled: true,
        busy: true,
      },
    );
  });

  it('includes selected only for a control that has the concept', () => {
    // A button is not "not selected"; a tab or a checkbox is. Announcing
    // "not selected" on every button is noise a screen-reader user
    // cannot turn off.
    expect(pressableA11y({ label: 'Book' }).accessibilityState).not.toHaveProperty('selected');
    expect(pressableA11y({ label: 'Past', selected: false }).accessibilityState).toMatchObject({
      selected: false,
    });
  });
});

describe('headingA11y and decorative', () => {
  it('marks a heading as a header, so the rotor can reach it', () => {
    expect(headingA11y('Appointments')).toEqual({
      accessible: true,
      accessibilityRole: 'header',
      accessibilityLabel: 'Appointments',
    });
  });

  it('hides decorative content on both platforms at once', () => {
    // iOS reads `accessibilityElementsHidden`, Android reads
    // `importantForAccessibility`. Setting one is a decoration that is
    // still announced on the other platform.
    expect(decorative).toEqual({
      accessible: false,
      importantForAccessibility: 'no-hide-descendants',
      accessibilityElementsHidden: true,
    });
  });
});

describe('announce (S-07)', () => {
  it('passes the message to the platform', () => {
    const spy = jest
      .spyOn(AccessibilityInfo, 'announceForAccessibility')
      .mockImplementation(() => {});

    announce('Appointment booked');

    expect(spy).toHaveBeenCalledWith('Appointment booked');
    spy.mockRestore();
  });
});

describe('focusOn', () => {
  it('does nothing for a null ref rather than throwing', () => {
    const spy = jest
      .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
      .mockImplementation(() => {});

    expect(() => focusOn(null)).not.toThrow();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('moves focus to a real mounted node', () => {
    const spy = jest
      .spyOn(AccessibilityInfo, 'sendAccessibilityEvent')
      .mockImplementation(() => {});
    let instance: HostInstance | null = null;

    render(
      createElement(View, {
        ref: (node: unknown) => {
          instance = node as HostInstance | null;
        },
      }),
    );
    focusOn(instance);

    // The mounted node itself, as a `focus` event — the renderer, not this
    // helper, turns it into whatever handle the platform wants. A numeric
    // tag looked up here was the pre-Fabric path, and under the Jest
    // renderer that lookup found nothing and focus silently went nowhere.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(instance, 'focus');
    expect(instance).not.toBeNull();
    spy.mockRestore();
  });
});

describe('labelWithHint joins on Android only', () => {
  const original = Platform.OS;

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', { value: original, configurable: true });
  });

  function setPlatform(os: 'ios' | 'android') {
    Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
  }

  it('joins label and hint on Android, where TalkBack drops the hint', () => {
    setPlatform('android');
    expect(labelWithHint('Call Ambulance', 'Opens a confirmation first')).toBe(
      'Call Ambulance. Opens a confirmation first',
    );
  });

  it('leaves the label alone on iOS, which reads both', () => {
    setPlatform('ios');
    // Joining here would make VoiceOver read the hint twice.
    expect(labelWithHint('Call Ambulance', 'Opens a confirmation first')).toBe('Call Ambulance');
  });
});

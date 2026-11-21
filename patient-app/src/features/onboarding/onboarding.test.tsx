import { fireEvent, screen } from '@testing-library/react-native';

import { en } from '@/i18n/messages';
import { PREFERENCE_KEYS, preferenceStore } from '@/storage/preference-store';
import { renderWithProviders } from '@/test/render';

import { OnboardingScreen } from './screens/OnboardingScreen';
import { forgetOnboarding, hasSeenOnboarding, markOnboardingSeen } from './seen';
import { ONBOARDING_SLIDES } from './slides';

/**
 * Onboarding — checklist E-02.
 *
 * The two tests that matter are not about the carousel. One is that
 * Emergency is reachable from it, because this screen sits in front of
 * the one that carries E-01's guarantee. The other is that skipping
 * counts as an answer, because "never shown twice" is the row's criterion
 * and an app that re-asks after a skip has not accepted it.
 */

function navigationDouble() {
  return {
    replace: jest.fn(),
    navigate: jest.fn(),
  };
}

function renderOnboarding(navigation = navigationDouble()) {
  renderWithProviders(
    <OnboardingScreen
      navigation={navigation as never}
      route={{ key: 'Onboarding', name: 'Onboarding' } as never}
    />,
  );
  return navigation;
}

describe('the slides', () => {
  beforeEach(forgetOnboarding);

  it('is at most three, as the row requires', () => {
    expect(ONBOARDING_SLIDES.length).toBeGreaterThan(0);
    expect(ONBOARDING_SLIDES.length).toBeLessThanOrEqual(3);
  });

  it('promises nothing the app cannot do yet', () => {
    // A promise made on the first screen is the one a patient remembers
    // when the screen it described turns out to be empty. Messaging is
    // not MVP, records are blocked by ADR-031, and there is no AI.
    //
    // Read out of the English catalogue since C-09: the slides carry
    // keys, and the promise is in the words a patient reads.
    const copy = ONBOARDING_SLIDES.map((slide) => `${en[slide.titleKey]} ${en[slide.bodyKey]}`)
      .join(' ')
      .toLowerCase();
    for (const unbuilt of ['message', 'chat', 'lab result', 'prescription', 'ai ', 'assistant']) {
      expect(copy).not.toContain(unbuilt);
    }
  });

  it('renders every slide, so none is unreachable by scrolling', () => {
    renderOnboarding();

    for (const slide of ONBOARDING_SLIDES) {
      expect(screen.getByTestId(`onboarding-slide-${slide.id}`)).toBeTruthy();
    }
  });
});

describe('the way out', () => {
  beforeEach(forgetOnboarding);

  it('shows Skip on the first slide', () => {
    renderOnboarding();

    expect(screen.getByTestId('onboarding-skip')).toBeTruthy();
  });

  it('treats a skip as an answer and does not re-ask', () => {
    const navigation = renderOnboarding();

    fireEvent.press(screen.getByTestId('onboarding-skip'));

    expect(hasSeenOnboarding()).toBe(true);
    expect(navigation.replace).toHaveBeenCalledWith('Welcome');
  });

  it('replaces rather than pushes, so Back cannot return to it', () => {
    const navigation = renderOnboarding();

    fireEvent.press(screen.getByTestId('onboarding-skip'));

    expect(navigation.replace).toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalledWith('Welcome');
  });
});

describe('emergency', () => {
  beforeEach(forgetOnboarding);

  it('is reachable from the carousel, not only from Welcome', () => {
    // E-01 put emergency access above the fold on Welcome so a person in
    // crisis is never reading marketing copy. A carousel in front of
    // Welcome would undo that on the one launch where the patient does
    // not know where anything is.
    const navigation = renderOnboarding();

    fireEvent.press(screen.getByTestId('onboarding-emergency'));

    expect(navigation.navigate).toHaveBeenCalledWith('Emergency');
  });

  it('does not mark onboarding seen on the way to Emergency', () => {
    // Reaching for help is not "I have read the introduction". The
    // carousel should still be there afterwards.
    renderOnboarding();

    fireEvent.press(screen.getByTestId('onboarding-emergency'));

    expect(hasSeenOnboarding()).toBe(false);
  });

  it('navigates rather than dialling', () => {
    // Every dial in this app is behind the two-step confirmation (R-6),
    // and the launch screen is the worst possible place to break that.
    const navigation = renderOnboarding();

    fireEvent.press(screen.getByTestId('onboarding-emergency'));

    expect(navigation.navigate).toHaveBeenCalledWith('Emergency');
  });
});

describe('finishing', () => {
  beforeEach(forgetOnboarding);

  it('advances rather than finishing while slides remain', () => {
    const navigation = renderOnboarding();

    fireEvent.press(screen.getByTestId('onboarding-next'));

    expect(hasSeenOnboarding()).toBe(false);
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('finishes from the last slide', () => {
    const navigation = renderOnboarding();

    for (let step = 0; step < ONBOARDING_SLIDES.length - 1; step += 1) {
      fireEvent.press(screen.getByTestId('onboarding-next'));
    }
    fireEvent.press(screen.getByTestId('onboarding-next'));

    expect(hasSeenOnboarding()).toBe(true);
    expect(navigation.replace).toHaveBeenCalledWith('Welcome');
  });

  it('marks exactly one dot active', () => {
    renderOnboarding();

    expect(screen.getAllByTestId('onboarding-dot-active')).toHaveLength(1);
    expect(screen.getAllByTestId('onboarding-dot-inactive')).toHaveLength(
      ONBOARDING_SLIDES.length - 1,
    );
  });

  it('follows a swipe to the last slide, not only the Next button', () => {
    // The carousel is scrollable, so a patient can reach the last slide
    // without pressing anything — and `onMomentumScrollEnd` is the only
    // thing that tells the screen about it. Until 2026-09-13 nothing
    // exercised it, so a swipe could have left the button reading Next
    // on the final slide and the suite would have been green.
    //
    // The observable is the button's label: Next everywhere but the end,
    // Done on it. The dots carry no per-index testID, so "one is active"
    // cannot say *which*.
    renderOnboarding();
    // The width the screen divides by is `useWindowDimensions()`, which
    // under this renderer is React Native's own 750 — not the safe-area
    // frame `render.tsx` supplies. Dividing by the wrong one would put
    // the offset in the middle of a slide and prove nothing.
    const width = 750;
    const last = ONBOARDING_SLIDES.length - 1;

    // `onMomentumScrollEnd`, not `onScroll`: the index follows the
    // settled page rather than every pixel of the drag, so the dots do
    // not flicker mid-swipe.
    fireEvent(screen.getByTestId('onboarding-pager'), 'momentumScrollEnd', {
      nativeEvent: {
        contentOffset: { x: width * last, y: 0 },
        contentSize: { width: width * ONBOARDING_SLIDES.length, height: 800 },
        layoutMeasurement: { width, height: 800 },
      },
    });

    expect(screen.getByTestId('onboarding-next').props.accessibilityLabel).toBe(
      en['onboarding.finish'],
    );
  });

  it('ignores a settled scroll that lands back where it already was', () => {
    renderOnboarding();

    fireEvent(screen.getByTestId('onboarding-pager'), 'momentumScrollEnd', {
      nativeEvent: {
        contentOffset: { x: 0, y: 0 },
        contentSize: { width: 750 * ONBOARDING_SLIDES.length, height: 800 },
        layoutMeasurement: { width: 750, height: 800 },
      },
    });

    expect(screen.getByTestId('onboarding-next').props.accessibilityLabel).toBe(
      en['onboarding.next'],
    );
  });

  it('treats a skip as an answer and does not re-ask', () => {
    const navigation = renderOnboarding();

    fireEvent.press(screen.getByTestId('onboarding-skip'));

    expect(hasSeenOnboarding()).toBe(true);
    expect(navigation.replace).toHaveBeenCalledWith('Welcome');
  });

  it('replaces rather than pushes, so Back cannot return to it', () => {
    const navigation = renderOnboarding();

    fireEvent.press(screen.getByTestId('onboarding-skip'));

    expect(navigation.replace).toHaveBeenCalled();
    expect(navigation.navigate).not.toHaveBeenCalledWith('Welcome');
  });
});

describe('emergency', () => {
  beforeEach(forgetOnboarding);

  it('is reachable from the carousel, not only from Welcome', () => {
    // E-01 put emergency access above the fold on Welcome so a person in
    // crisis is never reading marketing copy. A carousel in front of
    // Welcome would undo that on the one launch where the patient does
    // not know where anything is.
    const navigation = renderOnboarding();

    fireEvent.press(screen.getByTestId('onboarding-emergency'));

    expect(navigation.navigate).toHaveBeenCalledWith('Emergency');
  });

  it('does not mark onboarding seen on the way to Emergency', () => {
    // Reaching for help is not "I have read the introduction". The
    // carousel should still be there afterwards.
    renderOnboarding();

    fireEvent.press(screen.getByTestId('onboarding-emergency'));

    expect(hasSeenOnboarding()).toBe(false);
  });

  it('navigates rather than dialling', () => {
    // Every dial in this app is behind the two-step confirmation (R-6),
    // and the launch screen is the worst possible place to break that.
    const navigation = renderOnboarding();

    fireEvent.press(screen.getByTestId('onboarding-emergency'));

    expect(navigation.navigate).toHaveBeenCalledWith('Emergency');
  });
});

describe('finishing', () => {
  beforeEach(forgetOnboarding);

  it('advances rather than finishing while slides remain', () => {
    const navigation = renderOnboarding();

    fireEvent.press(screen.getByTestId('onboarding-next'));

    expect(hasSeenOnboarding()).toBe(false);
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it('finishes from the last slide', () => {
    const navigation = renderOnboarding();

    for (let step = 0; step < ONBOARDING_SLIDES.length - 1; step += 1) {
      fireEvent.press(screen.getByTestId('onboarding-next'));
    }
    fireEvent.press(screen.getByTestId('onboarding-next'));

    expect(hasSeenOnboarding()).toBe(true);
    expect(navigation.replace).toHaveBeenCalledWith('Welcome');
  });

  it('marks exactly one dot active', () => {
    renderOnboarding();

    expect(screen.getAllByTestId('onboarding-dot-active')).toHaveLength(1);
    expect(screen.getAllByTestId('onboarding-dot-inactive')).toHaveLength(
      ONBOARDING_SLIDES.length - 1,
    );
  });
});

describe('the seen flag', () => {
  beforeEach(forgetOnboarding);

  it('is false until something sets it', () => {
    expect(hasSeenOnboarding()).toBe(false);
  });

  it('is true afterwards, and stays true', () => {
    markOnboardingSeen();

    expect(hasSeenOnboarding()).toBe(true);
    markOnboardingSeen();
    expect(hasSeenOnboarding()).toBe(true);
  });

  it('records only that it was seen, never when or how far', () => {
    markOnboardingSeen();

    // Whether a patient read three slides says nothing about their
    // health; when they read them, and how far they got, starts to.
    expect(preferenceStore.get(PREFERENCE_KEYS.onboardingSeen)).toBe('true');
  });
});

const GLICKO2_SCALE = 173.7178;
const DEFAULT_RATING = 1500;
const DEFAULT_RATING_DEVIATION = 350;
const DEFAULT_VOLATILITY = 0.06;
const DEFAULT_TAU = 0.5;
const CONVERGENCE_TOLERANCE = 0.000001;

export interface Glicko2Rating {
  rating: number;
  ratingDeviation: number;
  volatility: number;
}

export interface Glicko2Match {
  opponentId: string;
  score: 0 | 0.5 | 1;
}

export interface Glicko2Options {
  initialRating?: number;
  initialRatingDeviation?: number;
  initialVolatility?: number;
  tau?: number;
}

function createInitialRating(options: Glicko2Options): Glicko2Rating {
  return {
    rating: options.initialRating ?? DEFAULT_RATING,
    ratingDeviation: options.initialRatingDeviation ?? DEFAULT_RATING_DEVIATION,
    volatility: options.initialVolatility ?? DEFAULT_VOLATILITY
  };
}

function toMu(rating: number, initialRating: number): number {
  return (rating - initialRating) / GLICKO2_SCALE;
}

function toPhi(ratingDeviation: number): number {
  return ratingDeviation / GLICKO2_SCALE;
}

function fromMu(mu: number, initialRating: number): number {
  return mu * GLICKO2_SCALE + initialRating;
}

function fromPhi(phi: number): number {
  return phi * GLICKO2_SCALE;
}

function g(phi: number): number {
  return 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));
}

function expectedScore(mu: number, opponentMu: number, opponentPhi: number): number {
  return 1 / (1 + Math.exp(-g(opponentPhi) * (mu - opponentMu)));
}

function volatilityFunction(delta: number, phi: number, variance: number, volatility: number, tau: number) {
  const a = Math.log(volatility * volatility);

  return (x: number) => {
    const expX = Math.exp(x);
    const numerator = expX * (delta * delta - phi * phi - variance - expX);
    const denominator = 2 * Math.pow(phi * phi + variance + expX, 2);
    return numerator / denominator - (x - a) / (tau * tau);
  };
}

function updateVolatility(delta: number, phi: number, variance: number, volatility: number, tau: number): number {
  const a = Math.log(volatility * volatility);
  const f = volatilityFunction(delta, phi, variance, volatility, tau);
  let lower = a;
  let upper: number;

  if (delta * delta > phi * phi + variance) {
    upper = Math.log(delta * delta - phi * phi - variance);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) {
      k += 1;
    }
    upper = a - k * tau;
  }

  let lowerValue = f(lower);
  let upperValue = f(upper);

  while (Math.abs(upper - lower) > CONVERGENCE_TOLERANCE) {
    const next = lower + ((lower - upper) * lowerValue) / (upperValue - lowerValue);
    const nextValue = f(next);
    if (nextValue * upperValue <= 0) {
      lower = upper;
      lowerValue = upperValue;
    } else {
      lowerValue /= 2;
    }
    upper = next;
    upperValue = nextValue;
  }

  return Math.exp(lower / 2);
}

export function createDefaultGlicko2Rating(options: Glicko2Options = {}): Glicko2Rating {
  return createInitialRating(options);
}

export function getConservativeGlicko2Rating(rating: Glicko2Rating, deviationScale = 2): number {
  return rating.rating - rating.ratingDeviation * deviationScale;
}

export function getGlicko2ExpectedScore(
  playerRating: Glicko2Rating,
  opponentRating: Glicko2Rating,
  options: Glicko2Options = {}
): number {
  const initialRating = options.initialRating ?? DEFAULT_RATING;
  return expectedScore(
    toMu(playerRating.rating, initialRating),
    toMu(opponentRating.rating, initialRating),
    toPhi(opponentRating.ratingDeviation)
  );
}

export function updateGlicko2RatingPeriod(
  currentRatings: Map<string, Glicko2Rating>,
  matchesByPlayer: Map<string, Glicko2Match[]>,
  options: Glicko2Options = {}
): Map<string, Glicko2Rating> {
  const initialRating = options.initialRating ?? DEFAULT_RATING;
  const tau = options.tau ?? DEFAULT_TAU;
  const previousRatings = new Map(currentRatings);
  const nextRatings = new Map(currentRatings);

  for (const [playerId, matches] of matchesByPlayer) {
    if (matches.length === 0) {
      continue;
    }

    const playerRating = previousRatings.get(playerId) ?? createInitialRating(options);
    const mu = toMu(playerRating.rating, initialRating);
    const phi = toPhi(playerRating.ratingDeviation);
    const volatility = playerRating.volatility;

    let varianceDenominator = 0;
    let ratingDeltaSum = 0;

    for (const match of matches) {
      const opponentRating = previousRatings.get(match.opponentId) ?? createInitialRating(options);
      const opponentMu = toMu(opponentRating.rating, initialRating);
      const opponentPhi = toPhi(opponentRating.ratingDeviation);
      const opponentG = g(opponentPhi);
      const expected = expectedScore(mu, opponentMu, opponentPhi);
      varianceDenominator += opponentG * opponentG * expected * (1 - expected);
      ratingDeltaSum += opponentG * (match.score - expected);
    }

    if (varianceDenominator <= 0 || !Number.isFinite(varianceDenominator)) {
      continue;
    }

    const variance = 1 / varianceDenominator;
    const delta = variance * ratingDeltaSum;
    const nextVolatility = updateVolatility(delta, phi, variance, volatility, tau);
    const preRatingPhi = Math.sqrt(phi * phi + nextVolatility * nextVolatility);
    const nextPhi = 1 / Math.sqrt(1 / (preRatingPhi * preRatingPhi) + 1 / variance);
    const nextMu = mu + nextPhi * nextPhi * ratingDeltaSum;

    nextRatings.set(playerId, {
      rating: fromMu(nextMu, initialRating),
      ratingDeviation: Math.min(DEFAULT_RATING_DEVIATION, fromPhi(nextPhi)),
      volatility: nextVolatility
    });
  }

  return nextRatings;
}

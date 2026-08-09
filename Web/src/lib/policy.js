import { calcStrength } from './strength';

const MIN_LENGTH = 12;

export function checkPolicy(pw, userInputs = []) {
  const strength = calcStrength(pw, userInputs);

const rules = [
    {
      id: 'length',
      label: `At least ${MIN_LENGTH} characters`,
      ok: pw.length >= MIN_LENGTH
    },
    {
      id: 'strength',
      label: 'Not easily guessed',
      ok: strength.score >= 5,
      // zxcvbn names the pattern it found. Only worth showing when
      // the rule is failing — advice on a passing check is noise.
      hint: strength.score >= 5 ? null : strength.tip
    }
  ];

  return { rules, passed: rules.every(r => r.ok), strength };
}
const OKINA_VARIANTS = /[ʻʼ'`‘’]/g;
const SPACE_RE = /\s+/g;
const PUNCTUATION_RE = /[.,!?;:]/g;

function normalizeUnicode(value = "") {
  return value.normalize("NFC");
}

function normalizeCommon(value = "") {
  return normalizeUnicode(value)
    .toLowerCase()
    .replace(SPACE_RE, " ")
    .trim();
}

function normalizeEnglish(value = "") {
  return normalizeCommon(value)
    .replace(PUNCTUATION_RE, "")
    .replace(SPACE_RE, " ")
    .trim();
}

function stripHawaiianOrthography(value = "") {
  return normalizeCommon(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(OKINA_VARIANTS, "")
    .normalize("NFC")
    .replace(PUNCTUATION_RE, "")
    .replace(SPACE_RE, " ")
    .trim();
}

function normalizeHawaiianStrict(value = "") {
  return normalizeCommon(value)
    .replace(/[ʼ'`‘’]/g, "ʻ")
    .replace(PUNCTUATION_RE, "")
    .replace(SPACE_RE, " ")
    .trim();
}

function countOkina(value = "") {
  const matches = normalizeUnicode(value).match(OKINA_VARIANTS);
  return matches ? matches.length : 0;
}

function countKahako(value = "") {
  const nfd = normalizeUnicode(value).normalize("NFD");
  const matches = nfd.match(/\u0304/g);
  return matches ? matches.length : 0;
}

function orthographyNotes(given, expected) {
  const notes = [];
  const givenOkina = countOkina(given);
  const expectedOkina = countOkina(expected);
  const givenKahako = countKahako(given);
  const expectedKahako = countKahako(expected);

  if (givenOkina < expectedOkina) notes.push("Check the missing ʻokina.");
  if (givenOkina > expectedOkina) notes.push("There is an extra ʻokina.");
  if (givenKahako < expectedKahako) notes.push("Check the missing kahakō.");
  if (givenKahako > expectedKahako) notes.push("There is an extra kahakō.");

  if (!notes.length) {
    notes.push("The base letters match, but the Hawaiian spelling marks are not in the expected positions.");
  }

  return notes;
}

/**
 * Returns one of:
 * - correct: the answer matches the expected Hawaiian spelling
 * - almost: the base letters match, but ʻokina/kahakō differ
 * - incorrect: the lexical answer differs
 */
export function gradeAnswer(given, expected, language = "haw", alternatives = []) {
  const candidates = [expected, ...alternatives].filter(Boolean);

  if (language !== "haw") {
    const normalizedGiven = normalizeEnglish(given);
    const match = candidates.find(candidate => normalizeEnglish(candidate) === normalizedGiven);
    return match
      ? { status: "correct", expected: match, notes: [] }
      : { status: "incorrect", expected, notes: [] };
  }

  const strictGiven = normalizeHawaiianStrict(given);
  const strictMatch = candidates.find(candidate => normalizeHawaiianStrict(candidate) === strictGiven);
  if (strictMatch) {
    return { status: "correct", expected: strictMatch, notes: [] };
  }

  const relaxedGiven = stripHawaiianOrthography(given);
  const relaxedMatch = candidates.find(candidate => stripHawaiianOrthography(candidate) === relaxedGiven);
  if (relaxedMatch && relaxedGiven.length > 0) {
    return {
      status: "almost",
      expected: relaxedMatch,
      notes: orthographyNotes(given, relaxedMatch)
    };
  }

  return { status: "incorrect", expected, notes: [] };
}

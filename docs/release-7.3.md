# Version 7.3.0 — 28 October 2026

Polish the existing sourced curriculum without adding Hawaiian sentences.

- Lessons use sections of up to 12 activities, preferring a new study boundary after eight. The next section resumes from the saved lesson position.
- Lesson purpose stays visible during study. Section completion explains saved progress and summarizes checks without claiming mastery.
- Progress recommends due review, difficult items, or lesson selection, and explains that overall correctness includes supported attempts and retries.
- Incorrect answers receive skill-specific comparison guidance when no more specific diagnosis applies.
- Listening includes an optional reflection, replay guidance, and saved latest reflection. These remain self-reports rather than comprehension scores.
- Feedback uses a polite screen-reader status region. Existing mobile scrolling, pull-to-refresh, storage identifiers and language sources are preserved.

Validation: curriculum regression checks over 352 activities; browser traversal of all 346 learning activities across section boundaries; reload/resume, hidden answers, retry scheduling, listening confirmation/reflection persistence, progress actions and mobile overflow checks. Legacy olelo.html is untouched. Version and asset URLs are 7.3.0; live wrapper uses the exact source commit.

Limitations remain: no qualified educator certification, measured spoken proficiency or independent learning-outcome study. This release improves usability, not the scope of those claims.

# Exam Builder Frontend

This project provides a browser-based interface for building, managing, and analysing exams that draw questions from a Supabase-hosted question bank. It is designed to work with the `questions` table structure described in the project brief.

The application is implemented as a standalone HTML/JavaScript experience that uses modern ES modules loaded directly from CDNs. No build tooling is required—open the `index.html` file in a modern browser to get started.

## Features

### Import
- Upload CSV or JSON files that match the Supabase `questions` table schema.
- Process files in batches with progress feedback and logging.
- Apply optional course labels and review status defaults while importing.

### Exam Generation
- Configure exam metadata (title, instructor, course, duration, instructions).
- Filter the question pool by course, review status, chapter text, keyword(s), and maximum pool size.
- Specify exact counts for question types and difficulty levels.
- Shuffle MCQ choices, toggle question IDs, and include an answer key.
- Export the generated exam to PDF (via `jsPDF`) or send it to the printer with clean formatting.

### Manage
- Review the most recently generated exam, update key fields, and sync changes back to Supabase.
- Look up any question by unique ID and inspect its full details.

### Statistics
- View global metrics (by course, type, difficulty) derived from the Supabase dataset.
- See exam-specific distribution summaries for the current exam.

### History
- Maintain a local (browser-only) history of generated exams for quick reopening.

## Project Structure

```
├── index.html             # Application entry point and layout
├── styles.css             # Styling for the interface and print layout
└── src
    ├── config.example.js  # Supabase configuration template
    └── main.js            # Application logic
```

## Configuration

1. Duplicate `src/config.example.js` and rename the copy to `src/config.js`.
2. Populate the new file with your Supabase project URL and public anon key:

   ```js
   export const SUPABASE_URL = 'https://your-project.supabase.co';
   export const SUPABASE_ANON_KEY = 'your-public-anon-key';
   ```

3. Ensure your Supabase project contains a `questions` table whose columns align with the import format (see the project brief for field definitions).

> **Note:** `src/config.js` is intentionally ignored by Git so your credentials are not committed.

## Running the App

Because everything is packaged as native ES modules, no bundler is required. You can:

- Open `index.html` directly in your browser, or
- Serve the folder through a simple static server (e.g., `python -m http.server 4173` or `npm run serve`).

A network connection is required at runtime so the browser can load the CDN-hosted libraries (`@supabase/supabase-js`, `PapaParse`, `jsPDF`, `html2canvas`, and `dayjs`).

## Import Guidelines

- CSV files must contain headers matching the Supabase column names.
- JSON files should follow the format:

  ```json
  {
    "questions": [
      {
        "unique_id": "BIO1130_T5_MCQ_001",
        "question_text": "What is the correct definition of adaptation as a noun?",
        "question_type": "MCQ",
        "difficulty": "Easy",
        "options": {
          "A": "Trait A",
          "B": "Trait B",
          "C": "Trait C",
          "D": "Trait D"
        },
        "correct_answer": "B"
      }
    ]
  }
  ```

  The importer automatically unwraps the root `questions` array if present.

- Large uploads are split into batches of 50 records to minimise request size.

## Exam History Persistence

Exam history lives in the browser’s `localStorage` only—it is not synced with Supabase. Clearing browser storage removes this history.

## Development Notes

- The codebase avoids build tooling to keep setup light. If you prefer a bundler or framework, you can migrate the assets into your preferred environment.
- The UI relies on modern browser APIs (`crypto.randomUUID`, `fetch`, module scripts). Ensure you test in an up-to-date browser.

## License

This project is provided as part of the Exam Builder engagement and inherits the licensing terms of that project.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.48.0/+esm';
import Papa from 'https://cdn.jsdelivr.net/npm/papaparse@5.4.1/+esm';
import { jsPDF } from 'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/+esm';
import html2canvas from 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/+esm';
import dayjs from 'https://cdn.jsdelivr.net/npm/dayjs@1.11.10/+esm';

const LOCAL_HISTORY_KEY = 'exam-builder-history';
const MAX_HISTORY = 15;
const IMPORT_BATCH_SIZE = 50;
const FETCH_PAGE_SIZE = 500;
const PLACEHOLDER_URL = 'https://your-project.supabase.co';
const PLACEHOLDER_KEY = 'public-anon-key';

let supabaseClient = null;
let cachedQuestions = [];
let cachedTypes = [];
let cachedDifficulties = [];
let generatedExam = null;
let examHistory = [];
let showIdsToggle = true;
let includeAnswersToggle = true;

const dom = {};

function cacheDomElements() {
  dom.navButtons = Array.from(document.querySelectorAll('.nav-button'));
  dom.panels = Array.from(document.querySelectorAll('.panel'));
  dom.connectionStatus = document.getElementById('connectionStatus');

  dom.importForm = document.getElementById('importForm');
  dom.importFile = document.getElementById('importFile');
  dom.importLog = document.getElementById('importLog');
  dom.importProgress = document.getElementById('importProgress');
  dom.importCourseLabel = document.getElementById('importCourseLabel');
  dom.importReviewStatus = document.getElementById('importReviewStatus');

  dom.generateForm = document.getElementById('generateForm');
  dom.typeList = document.getElementById('typeList');
  dom.difficultyList = document.getElementById('difficultyList');
  dom.refreshTypes = document.getElementById('refreshTypes');
  dom.refreshDifficulty = document.getElementById('refreshDifficulty');
  dom.generateError = document.getElementById('generateError');
  dom.examPreview = document.getElementById('examPreview');
  dom.exportPdf = document.getElementById('exportPdf');
  dom.printExam = document.getElementById('printExam');
  dom.shuffleChoices = document.getElementById('shuffleChoices');
  dom.showQuestionIds = document.getElementById('showQuestionIds');
  dom.includeAnswers = document.getElementById('includeAnswers');

  dom.manageCurrentExam = document.getElementById('manageCurrentExam');
  dom.searchForm = document.getElementById('searchForm');
  dom.searchId = document.getElementById('searchId');
  dom.searchResult = document.getElementById('searchResult');

  dom.globalStats = document.getElementById('globalStats');
  dom.examStats = document.getElementById('examStats');
  dom.historyList = document.getElementById('historyList');
}

function setupNavigation() {
  dom.navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.dataset.target;
      dom.navButtons.forEach((btn) => {
        btn.classList.toggle('active', btn === button);
        btn.setAttribute('aria-selected', btn === button ? 'true' : 'false');
      });
      dom.panels.forEach((panel) => {
        const isActive = panel.id === targetId;
        panel.classList.toggle('active', isActive);
        panel.setAttribute('aria-hidden', isActive ? 'false' : 'true');
      });
      if (targetId === 'statisticsPanel') {
        renderGlobalStatistics();
      }
      if (targetId === 'historyPanel') {
        renderHistory();
      }
    });
  });
}

function logImport(message) {
  if (!dom.importLog) return;
  dom.importLog.textContent += `${message}\n`;
  dom.importLog.scrollTop = dom.importLog.scrollHeight;
}

function setConnectionStatus(status, tone = 'neutral') {
  if (!dom.connectionStatus) return;
  dom.connectionStatus.textContent = status;
  dom.connectionStatus.dataset.tone = tone;
}

async function testConnection() {
  if (!supabaseClient) return false;
  try {
    const { error } = await supabaseClient.from('questions').select('id', { count: 'exact', head: true }).limit(1);
    if (error) throw error;
    setConnectionStatus('Connected', 'success');
    return true;
  } catch (error) {
    console.error(error);
    setConnectionStatus('Connection failed', 'error');
    return false;
  }
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('Failed to parse exam history', error);
    return [];
  }
}

function persistHistory() {
  localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(examHistory.slice(0, MAX_HISTORY)));
}

function upsertHistoryEntry(entry) {
  examHistory = [entry, ...examHistory.filter((item) => item.id !== entry.id)];
  if (examHistory.length > MAX_HISTORY) {
    examHistory.length = MAX_HISTORY;
  }
  persistHistory();
  renderHistory();
}

function formatDate(date) {
  return dayjs(date).format('YYYY-MM-DD HH:mm');
}

function renderHistory() {
  if (!dom.historyList) return;
  if (!examHistory.length) {
    dom.historyList.innerHTML = '<p>No exams generated yet.</p>';
    return;
  }
  dom.historyList.innerHTML = '';
  examHistory.forEach((entry) => {
    const container = document.createElement('div');
    container.className = 'history-item';
    container.innerHTML = `
      <strong>${entry.title}</strong>
      <span class="tag">${entry.course || 'No course'}</span>
      <span>Generated: ${formatDate(entry.generatedAt)}</span>
      <span>Questions: ${entry.questions.length}</span>
    `;
    const button = document.createElement('button');
    button.className = 'ghost';
    button.textContent = 'Reopen exam';
    button.addEventListener('click', () => {
      generatedExam = entry;
      renderExamPreview();
      renderManageCurrentExam();
      renderExamStatistics();
      dom.navButtons.find((btn) => btn.dataset.target === 'generatePanel').click();
    });
    container.appendChild(button);
    dom.historyList.appendChild(container);
  });
}

async function fetchAllQuestions(force = false) {
  if (!supabaseClient) return;
  if (cachedQuestions.length && !force) return;
  const allRows = [];
  let from = 0;
  let to = FETCH_PAGE_SIZE - 1;
  while (true) {
    const { data, error } = await supabaseClient.from('questions').select('*').range(from, to);
    if (error) {
      console.error('Failed to fetch questions', error);
      break;
    }
    if (!data || !data.length) {
      break;
    }
    allRows.push(...data);
    if (data.length < FETCH_PAGE_SIZE) {
      break;
    }
    from += FETCH_PAGE_SIZE;
    to += FETCH_PAGE_SIZE;
  }
  cachedQuestions = allRows;
  return cachedQuestions;
}

async function fetchDistinct(field) {
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from('questions')
    .select(`${field}`, { distinct: true })
    .not(field, 'is', null)
    .order(field, { ascending: true });
  if (error) {
    console.error(`Failed to fetch ${field}`, error);
    return [];
  }
  const values = (data || [])
    .map((row) => row[field])
    .filter((value) => value !== null && value !== undefined && `${value}`.trim().length)
    .map((value) => `${value}`.trim());
  return Array.from(new Set(values));
}

async function refreshTypeControls() {
  cachedTypes = await fetchDistinct('question_type');
  renderTypeControls();
}

async function refreshDifficultyControls() {
  cachedDifficulties = await fetchDistinct('difficulty');
  renderDifficultyControls();
}

function renderTypeControls() {
  if (!dom.typeList) return;
  dom.typeList.innerHTML = '';
  if (!cachedTypes.length) {
    dom.typeList.innerHTML = '<p>No question types found. Import or create questions first.</p>';
    return;
  }
  cachedTypes.forEach((type) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'chip';
    const inputId = `type-${type}`.replace(/[^a-z0-9-_]/gi, '-');
    wrapper.innerHTML = `
      <header>
        <strong>${type}</strong>
        <span class="tag">Type</span>
      </header>
      <label class="form-field">
        <span>Number of questions</span>
        <input type="number" min="0" value="0" id="${inputId}" data-type="${type}" />
      </label>
    `;
    dom.typeList.appendChild(wrapper);
  });
}

function renderDifficultyControls() {
  if (!dom.difficultyList) return;
  dom.difficultyList.innerHTML = '';
  if (!cachedDifficulties.length) {
    dom.difficultyList.innerHTML = '<p>No difficulty values found.</p>';
    return;
  }
  cachedDifficulties.forEach((difficulty) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'chip';
    const inputId = `difficulty-${difficulty}`.replace(/[^a-z0-9-_]/gi, '-');
    wrapper.innerHTML = `
      <header>
        <strong>${difficulty}</strong>
        <span class="tag">Difficulty</span>
      </header>
      <label class="form-field">
        <span>Number of questions</span>
        <input type="number" min="0" value="0" id="${inputId}" data-difficulty="${difficulty}" />
      </label>
    `;
    dom.difficultyList.appendChild(wrapper);
  });
}

async function handleImportSubmit(event) {
  event.preventDefault();
  if (!supabaseClient) {
    alert('Supabase is not configured.');
    return;
  }
  const file = dom.importFile.files[0];
  if (!file) {
    alert('Select a CSV or JSON file first.');
    return;
  }
  dom.importProgress.hidden = false;
  dom.importProgress.value = 0;
  dom.importLog.textContent = '';
  logImport(`Reading file: ${file.name}`);

  const reviewStatus = dom.importReviewStatus.value || null;
  const courseLabel = dom.importCourseLabel.value.trim();

  try {
    const questions = await parseImportFile(file);
    if (!Array.isArray(questions) || !questions.length) {
      throw new Error('No questions found in the provided file.');
    }
    logImport(`Parsed ${questions.length} questions.`);
    const decorated = questions.map((question) => ({
      ...question,
      review_status: question.review_status || reviewStatus || null,
      course: question.course || courseLabel || null,
    }));
    const chunks = chunkArray(decorated, IMPORT_BATCH_SIZE);
    for (let index = 0; index < chunks.length; index += 1) {
      const batch = chunks[index];
      dom.importProgress.value = Math.round(((index + 1) / chunks.length) * 100);
      logImport(`Uploading batch ${index + 1}/${chunks.length}…`);
      const { error } = await supabaseClient.from('questions').insert(batch);
      if (error) {
        logImport(`❌ Batch ${index + 1} failed: ${error.message}`);
        throw error;
      }
      logImport(`✅ Batch ${index + 1} uploaded.`);
    }
    dom.importProgress.value = 100;
    logImport('🎉 Import complete!');
    await fetchAllQuestions(true);
    await refreshTypeControls();
    await refreshDifficultyControls();
    renderGlobalStatistics();
  } catch (error) {
    console.error(error);
    logImport(`❌ Import failed: ${error.message}`);
  } finally {
    dom.importProgress.hidden = true;
  }
}

function resetImportForm() {
  dom.importForm.reset();
  dom.importLog.textContent = '';
  dom.importProgress.hidden = true;
}

function chunkArray(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

function parseImportFile(file) {
  if (file.name.toLowerCase().endsWith('.csv')) {
    return new Promise((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (results) => {
          if (results.errors && results.errors.length) {
            reject(new Error(results.errors.map((err) => err.message).join('\n')));
            return;
          }
          resolve(results.data);
        },
        error: (error) => reject(error),
      });
    });
  }
  return file
    .text()
    .then((text) => JSON.parse(text))
    .then((data) => {
      if (Array.isArray(data)) return data;
      if (data && Array.isArray(data.questions)) return data.questions;
      if (data && Array.isArray(data.items)) return data.items;
      return [];
    });
}

async function handleGenerateSubmit(event) {
  event.preventDefault();
  dom.generateError.hidden = true;
  dom.generateError.textContent = '';
  if (!supabaseClient) {
    dom.generateError.hidden = false;
    dom.generateError.textContent = 'Supabase is not configured.';
    return;
  }
  const formData = new FormData(dom.generateForm);
  const examDetails = {
    title: formData.get('examTitle')?.toString().trim() || document.getElementById('examTitle').value.trim(),
    instructor: document.getElementById('instructorName').value.trim(),
    course: document.getElementById('examCourse').value.trim(),
    duration: document.getElementById('examDuration').value.trim(),
    instructions: document.getElementById('examInstructions').value.trim(),
    generatedAt: new Date().toISOString(),
  };

  const filters = {
    keywords: document.getElementById('keywordFilter').value.trim(),
    chapter: document.getElementById('chapterFilter').value.trim(),
    reviewStatus: document.getElementById('reviewStatusFilter').value,
    course: document.getElementById('courseFilter').value.trim(),
    limit: parseInt(document.getElementById('questionLimit').value, 10) || 200,
  };

  showIdsToggle = dom.showQuestionIds.checked;
  includeAnswersToggle = dom.includeAnswers.checked;
  const shuffleChoices = dom.shuffleChoices.checked;

  const typeCounts = collectNumberSelections('[data-type]');
  const difficultyCounts = collectNumberSelections('[data-difficulty]');

  if (!typeCounts.length && !difficultyCounts.length) {
    dom.generateError.hidden = false;
    dom.generateError.textContent = 'Set at least one question type or difficulty count to generate an exam.';
    return;
  }

  try {
    const pool = await fetchQuestionPool(filters);
    if (!pool.length) {
      throw new Error('No questions matched your filters.');
    }
    const selection = selectQuestions(pool, { typeCounts, difficultyCounts });
    if (!selection.questions.length) {
      throw new Error('Unable to satisfy the requested distribution with the available questions.');
    }
    const preparedQuestions = selection.questions.map((question) =>
      transformQuestionForExam(question, { shuffleChoices })
    );

    generatedExam = {
      id: crypto.randomUUID(),
      ...examDetails,
      filters,
      questions: preparedQuestions,
      summary: selection.summary,
    };

    upsertHistoryEntry(generatedExam);
    renderExamPreview();
    renderManageCurrentExam();
    renderExamStatistics();
    dom.exportPdf.disabled = false;
    dom.printExam.disabled = false;
  } catch (error) {
    console.error(error);
    dom.generateError.hidden = false;
    dom.generateError.textContent = error.message;
  }
}

function collectNumberSelections(selector) {
  return Array.from(document.querySelectorAll(selector))
    .map((input) => ({ key: input.dataset.type || input.dataset.difficulty, count: parseInt(input.value, 10) || 0 }))
    .filter((item) => item.count > 0);
}

async function fetchQuestionPool(filters) {
  await fetchAllQuestions(true);
  let query = supabaseClient.from('questions').select('*').limit(filters.limit);
  if (filters.course) {
    query = query.eq('course', filters.course);
  }
  if (filters.reviewStatus) {
    query = query.eq('review_status', filters.reviewStatus);
  }
  if (filters.chapter) {
    query = query.ilike('chapter_name', `%${filters.chapter}%`);
  }
  if (filters.keywords) {
    const keywords = filters.keywords
      .split(',')
      .map((keyword) => keyword.trim())
      .filter(Boolean);
    if (keywords.length) {
      const orConditions = keywords
        .map((keyword) => [
          `question_text.ilike.%${keyword}%`,
          `keywords.ilike.%${keyword}%`,
          `answer_summary.ilike.%${keyword}%`,
        ])
        .flat();
      query = query.or(orConditions.join(','));
    }
  }
  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

function selectQuestions(pool, { typeCounts, difficultyCounts }) {
  const result = [];
  const remaining = [...pool];
  const summary = {
    byType: {},
    byDifficulty: {},
  };

  typeCounts.forEach(({ key, count }) => {
    const available = remaining.filter((question) => question.question_type === key);
    if (available.length < count) {
      console.warn(`Not enough questions for type ${key}. Requested ${count}, found ${available.length}.`);
    }
    const chosen = drawRandom(available, count);
    chosen.forEach((question) => removeQuestion(remaining, question));
    result.push(...chosen);
  });

  if (difficultyCounts.length) {
    difficultyCounts.forEach(({ key: difficulty, count: target }) => {
      const current = result.filter((question) => question.difficulty === difficulty);
      if (current.length >= target) {
        return;
      }
      const needed = target - current.length;
      const poolMatches = remaining.filter((question) => question.difficulty === difficulty);
      if (poolMatches.length < needed) {
        console.warn(
          `Not enough questions for difficulty ${difficulty}. Requested ${target}, found ${current.length + poolMatches.length}.`
        );
      }
      const chosen = drawRandom(poolMatches, needed);
      chosen.forEach((question) => removeQuestion(remaining, question));
      result.push(...chosen);
    });
  }

  const unique = deduplicateQuestions(result);
  shuffleInPlace(unique);

  unique.forEach((question) => {
    const type = question.question_type || 'Unknown';
    summary.byType[type] = (summary.byType[type] || 0) + 1;
    const difficulty = question.difficulty || 'Unknown';
    summary.byDifficulty[difficulty] = (summary.byDifficulty[difficulty] || 0) + 1;
  });

  return { questions: unique, summary };
}

function drawRandom(source, count) {
  if (!count) return [];
  const pool = [...source];
  shuffleInPlace(pool);
  return pool.slice(0, count);
}

function removeQuestion(pool, question) {
  const index = pool.findIndex((item) => item.id === question.id);
  if (index >= 0) {
    pool.splice(index, 1);
  }
}

function deduplicateQuestions(questions) {
  const seen = new Set();
  const unique = [];
  questions.forEach((question) => {
    if (!seen.has(question.id)) {
      unique.push(question);
      seen.add(question.id);
    }
  });
  return unique;
}

function shuffleInPlace(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
}

function transformQuestionForExam(question, { shuffleChoices }) {
  if (!shuffleChoices || question.question_type !== 'MCQ' || !question.options) {
    return question;
  }
  try {
    const options = normaliseOptions(question.options);
    const isObject = options && typeof options === 'object' && !Array.isArray(options);
    if (!Array.isArray(options) && !isObject) {
      return question;
    }
    const entries = Array.isArray(options)
      ? options.map((text, index) => ({ label: String.fromCharCode(65 + index), text }))
      : Object.entries(options).map(([label, text]) => ({ label, text }));
    if (!entries.length) return question;

    const correctAnswers = parseCorrectAnswer(question.correct_answer);
    const annotated = entries.map((entry) => ({
      ...entry,
      isCorrect:
        correctAnswers.includes(entry.label) ||
        correctAnswers.includes(String(entry.text).trim()) ||
        correctAnswers.includes(String(entry.label).trim()),
    }));

    shuffleInPlace(annotated);
    const newOptions = {};
    const newCorrect = [];
    annotated.forEach((entry, index) => {
      const label = String.fromCharCode(65 + index);
      newOptions[label] = entry.text;
      if (entry.isCorrect) {
        newCorrect.push(label);
      }
    });

    return {
      ...question,
      options: newOptions,
      correct_answer: newCorrect.length <= 1 ? newCorrect[0] || question.correct_answer : newCorrect,
    };
  } catch (error) {
    console.warn('Failed to shuffle MCQ options', error);
    return question;
  }
}

function parseCorrectAnswer(answer) {
  if (!answer && answer !== 0) return [];
  let parsed = answer;
  if (typeof parsed === 'string') {
    const trimmed = parsed.trim();
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      if (trimmed.includes(',')) {
        return trimmed.split(',').map((value) => value.trim()).filter(Boolean);
      }
      return [trimmed];
    }
  }
  if (Array.isArray(parsed)) {
    return parsed.map((value) => String(value).trim()).filter(Boolean);
  }
  if (parsed && typeof parsed === 'object') {
    const values = Object.values(parsed).map((value) => String(value).trim());
    const keys = Object.keys(parsed).map((key) => String(key).trim());
    return [...new Set([...keys, ...values].filter(Boolean))];
  }
  return [String(parsed).trim()].filter(Boolean);
}

function renderExamPreview() {
  if (!dom.examPreview) return;
  if (!generatedExam) {
    dom.examPreview.innerHTML = '<p>No exam generated yet. Configure filters and click "Generate exam".</p>';
    dom.exportPdf.disabled = true;
    dom.printExam.disabled = true;
    return;
  }

  const container = document.createElement('div');
  container.innerHTML = '';
  const header = document.createElement('header');
  header.innerHTML = `
    <h2>${escapeHtml(generatedExam.title || 'Untitled exam')}</h2>
    <div class="meta">
      <div><strong>Instructor:</strong> ${escapeHtml(generatedExam.instructor || '—')}</div>
      <div><strong>Course:</strong> ${escapeHtml(generatedExam.course || '—')}</div>
      <div><strong>Date:</strong> ${escapeHtml(formatDate(generatedExam.generatedAt))}</div>
      <div><strong>Duration:</strong> ${escapeHtml(generatedExam.duration || '—')}</div>
    </div>
  `;
  container.appendChild(header);

  if (generatedExam.instructions) {
    const instructions = document.createElement('section');
    instructions.innerHTML = `
      <h3>Instructions</h3>
      <p>${escapeHtml(generatedExam.instructions)}</p>
    `;
    container.appendChild(instructions);
  }

  const questionsWrapper = document.createElement('section');
  generatedExam.questions.forEach((question, index) => {
    const block = document.createElement('article');
    block.className = 'question';
    const questionId = question.unique_id || question.id || `Question-${index + 1}`;
    const titleParts = [];
    titleParts.push(`${index + 1}.`);
    if (showIdsToggle) {
      titleParts.push(`<span class="tag">${escapeHtml(questionId)}</span>`);
    }
    titleParts.push(escapeHtml(question.question_text || 'No question text'));
    block.innerHTML = `<h3>${titleParts.join(' ')}</h3>`;

    if (question.question_type) {
      const typeTag = document.createElement('div');
      typeTag.className = 'tag';
      typeTag.textContent = question.question_type;
      block.appendChild(typeTag);
    }

    const content = document.createElement('div');
    const optionsMarkup = renderQuestionOptions(question);
    content.innerHTML = optionsMarkup;
    block.appendChild(content);

    if (question.difficulty) {
      const difficultyTag = document.createElement('div');
      difficultyTag.className = 'tag';
      difficultyTag.textContent = `Difficulty: ${question.difficulty}`;
      block.appendChild(difficultyTag);
    }

    if (question.answer_summary) {
      const summary = document.createElement('p');
      summary.innerHTML = `<em>Answer summary:</em> ${escapeHtml(question.answer_summary)}`;
      block.appendChild(summary);
    }

    if (question.detailed_explanation) {
      const explanation = document.createElement('pre');
      explanation.textContent = question.detailed_explanation;
      block.appendChild(explanation);
    }

    questionsWrapper.appendChild(block);
  });
  container.appendChild(questionsWrapper);

  if (includeAnswersToggle) {
    const answers = document.createElement('section');
    answers.className = 'answer-key';
    answers.innerHTML = '<h3>Answer key</h3>';
    const list = document.createElement('ol');
    generatedExam.questions.forEach((question) => {
      const item = document.createElement('li');
      const label = question.unique_id || question.id || 'Unknown ID';
      item.innerHTML = `<strong>${escapeHtml(label)}</strong>: ${escapeHtml(formatCorrectAnswer(question))}`;
      list.appendChild(item);
    });
    answers.appendChild(list);
    container.appendChild(answers);
  }

  dom.examPreview.innerHTML = '';
  dom.examPreview.appendChild(container);
  dom.exportPdf.disabled = false;
  dom.printExam.disabled = false;
}

function renderQuestionOptions(question) {
  const type = (question.question_type || '').toLowerCase();
  const correct = question.correct_answer;
  if (type === 'mcq' && question.options) {
    const options = normaliseOptions(question.options);
    if (Array.isArray(options)) {
      return `
        <ol class="choice-list">
          ${options.map((option) => `<li>${escapeHtml(option)}</li>`).join('')}
        </ol>`;
    }
    if (!options || typeof options !== 'object') {
      return '';
    }
    const entries = Object.entries(options || {});
    return `
      <ol class="choice-list">
        ${entries
          .map(([key, value]) => `<li><strong>${escapeHtml(key)}.</strong> ${escapeHtml(value)}</li>`)
          .join('')}
      </ol>`;
  }
  if (['true/false', 'true or false', 'truefalse'].includes(type)) {
    return '<p>Circle <strong>True</strong> or <strong>False</strong>.</p>';
  }
  if (['short answer', 'short-answer'].includes(type)) {
    return '<p>Write your answer in the space provided.</p>';
  }
  if (['fill-in-blank', 'fill in blank', 'fill_in_blank'].includes(type)) {
    return '<p>Complete the blank(s) with the correct term.</p>';
  }
  if (type === 'matching' && question.options) {
    const options = normaliseOptions(question.options);
    const pairs = options?.pairs || options;
    if (pairs && typeof pairs === 'object') {
      const rows = Object.entries(pairs)
        .map(([leftKey, value]) => `<tr><td>${escapeHtml(leftKey)}</td><td>${escapeHtml(value)}</td></tr>`)
        .join('');
      return `<table class="table"><tbody>${rows}</tbody></table>`;
    }
  }
  if (correct && typeof correct === 'string' && correct.length < 120) {
    return `<p><em>Expected answer:</em> ${escapeHtml(correct)}</p>`;
  }
  return '';
}

function normaliseOptions(options) {
  if (!options) return null;
  if (typeof options === 'string') {
    try {
      return JSON.parse(options);
    } catch (error) {
      return options;
    }
  }
  return options;
}

function formatCorrectAnswer(question) {
  if (!question.correct_answer) return 'No answer recorded';
  if (typeof question.correct_answer === 'string') return question.correct_answer;
  if (Array.isArray(question.correct_answer)) return question.correct_answer.join(', ');
  if (typeof question.correct_answer === 'object') {
    return Object.entries(question.correct_answer)
      .map(([key, value]) => `${key}: ${value}`)
      .join('; ');
  }
  return String(question.correct_answer);
}

function escapeHtml(value) {
  return `${value || ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderManageCurrentExam() {
  if (!dom.manageCurrentExam) return;
  if (!generatedExam) {
    dom.manageCurrentExam.innerHTML = '<p>No exam generated yet.</p>';
    return;
  }
  dom.manageCurrentExam.innerHTML = '';
  generatedExam.questions.forEach((question) => {
    const editor = document.createElement('div');
    editor.className = 'manage-editor';
    editor.dataset.questionId = question.id;
    editor.innerHTML = `
      <div><strong>${escapeHtml(question.unique_id || question.id)}</strong> — ${escapeHtml(question.question_text)}</div>
      <label class="form-field">
        <span>Difficulty</span>
        <input type="text" value="${escapeHtml(question.difficulty || '')}" data-field="difficulty" />
      </label>
      <label class="form-field">
        <span>Keywords</span>
        <input type="text" value="${escapeHtml(question.keywords || '')}" data-field="keywords" />
      </label>
      <label class="form-field">
        <span>Answer summary</span>
        <textarea rows="2" data-field="answer_summary">${escapeHtml(question.answer_summary || '')}</textarea>
      </label>
      <label class="form-field">
        <span>Detailed explanation</span>
        <textarea rows="3" data-field="detailed_explanation">${escapeHtml(question.detailed_explanation || '')}</textarea>
      </label>
      <label class="form-field">
        <span>Instructor notes</span>
        <textarea rows="2" data-field="instructor_notes">${escapeHtml(question.instructor_notes || '')}</textarea>
      </label>
      <label class="form-field">
        <span>Review status</span>
        <input type="text" value="${escapeHtml(question.review_status || '')}" data-field="review_status" />
      </label>
      <footer>
        <button type="button" class="ghost" data-action="reset">Reset</button>
        <button type="button" class="primary" data-action="save">Save changes</button>
      </footer>
    `;
    editor.addEventListener('click', async (event) => {
      if (!(event.target instanceof HTMLElement)) return;
      const action = event.target.dataset.action;
      if (!action) return;
      if (action === 'reset') {
        renderManageCurrentExam();
        return;
      }
      if (action === 'save') {
        await saveQuestionUpdates(editor, question.id);
      }
    });
    dom.manageCurrentExam.appendChild(editor);
  });
}

async function saveQuestionUpdates(editor, questionId) {
  const formFields = Array.from(editor.querySelectorAll('[data-field]'));
  const updates = {};
  formFields.forEach((field) => {
    if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement) {
      updates[field.dataset.field] = field.value;
    }
  });
  try {
    const { error } = await supabaseClient.from('questions').update(updates).eq('id', questionId);
    if (error) throw error;
    editor.classList.add('success');
    setTimeout(() => editor.classList.remove('success'), 1500);
    await fetchAllQuestions(true);
    const index = generatedExam.questions.findIndex((question) => question.id === questionId);
    if (index >= 0) {
      generatedExam.questions[index] = { ...generatedExam.questions[index], ...updates };
    }
    persistHistory();
    renderHistory();
    renderExamPreview();
    renderExamStatistics();
    renderManageCurrentExam();
  } catch (error) {
    alert(`Failed to update question: ${error.message}`);
  }
}

async function handleSearchSubmit(event) {
  event.preventDefault();
  if (!supabaseClient) {
    dom.searchResult.innerHTML = '<p>Supabase is not configured.</p>';
    return;
  }
  const id = dom.searchId.value.trim();
  if (!id) return;
  dom.searchResult.textContent = 'Searching…';
  try {
    const { data, error } = await supabaseClient.from('questions').select('*').eq('unique_id', id).maybeSingle();
    if (error) throw error;
    if (!data) {
      dom.searchResult.innerHTML = '<p>No question found with that ID.</p>';
      return;
    }
    dom.searchResult.innerHTML = renderQuestionDetail(data);
  } catch (error) {
    dom.searchResult.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
  }
}

function renderQuestionDetail(question) {
  const optionsMarkup = renderQuestionOptions(question);
  return `
    <article class="question">
      <h3>${escapeHtml(question.unique_id || question.id)}</h3>
      <p>${escapeHtml(question.question_text)}</p>
      ${optionsMarkup}
      <p><strong>Correct answer:</strong> ${escapeHtml(formatCorrectAnswer(question))}</p>
      <p><strong>Difficulty:</strong> ${escapeHtml(question.difficulty || '—')}</p>
      <p><strong>Review status:</strong> ${escapeHtml(question.review_status || '—')}</p>
      <p><strong>Keywords:</strong> ${escapeHtml(question.keywords || '—')}</p>
    </article>
  `;
}

function renderGlobalStatistics() {
  if (!dom.globalStats) return;
  if (!cachedQuestions.length) {
    dom.globalStats.innerHTML = '<p>No data yet. Import questions or check your Supabase configuration.</p>';
    return;
  }
  const total = cachedQuestions.length;
  const byCourse = groupCount(cachedQuestions, 'course');
  const byType = groupCount(cachedQuestions, 'question_type');
  const byDifficulty = groupCount(cachedQuestions, 'difficulty');
  const uniqueQuestionIds = new Set(
    cachedQuestions.map((question) => question.unique_id || question.id)
  );
  const repeatedCount = Math.max(0, total - uniqueQuestionIds.size);

  dom.globalStats.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <h4>Total questions</h4>
        <p>${total}</p>
      </div>
      <div class="stat-card">
        <h4>Courses</h4>
        <p>${Object.keys(byCourse).length}</p>
      </div>
      <div class="stat-card">
        <h4>Question types</h4>
        <p>${Object.keys(byType).length}</p>
      </div>
      <div class="stat-card">
        <h4>Difficulties</h4>
        <p>${Object.keys(byDifficulty).length}</p>
      </div>
      <div class="stat-card">
        <h4>Repeated IDs</h4>
        <p>${repeatedCount}</p>
      </div>
    </div>
    ${renderStatTable('By course', byCourse, total)}
    ${renderStatTable('By question type', byType, total)}
    ${renderStatTable('By difficulty', byDifficulty, total)}
  `;
}

function renderExamStatistics() {
  if (!dom.examStats) return;
  if (!generatedExam) {
    dom.examStats.innerHTML = 'Generate an exam to view its breakdown.';
    return;
  }
  const total = generatedExam.questions.length;
  const byType = groupCount(generatedExam.questions, 'question_type');
  const byDifficulty = groupCount(generatedExam.questions, 'difficulty');
  const uniqueIds = new Set(
    generatedExam.questions.map((question) => question.unique_id || question.id || crypto.randomUUID())
  );
  const duplicateCount = Math.max(0, total - uniqueIds.size);
  dom.examStats.innerHTML = `
    <h3>${escapeHtml(generatedExam.title)}</h3>
    <p>Generated ${escapeHtml(formatDate(generatedExam.generatedAt))} — ${total} questions</p>
    <p>Unique questions: ${uniqueIds.size} · Repeated in exam: ${duplicateCount}</p>
    ${renderStatTable('By question type', byType, total)}
    ${renderStatTable('By difficulty', byDifficulty, total)}
  `;
}

function renderStatTable(title, counts, total) {
  const rows = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => {
      const percent = total ? ((count / total) * 100).toFixed(1) : '0.0';
      return `<tr><th>${escapeHtml(key || 'Unknown')}</th><td>${count}</td><td>${percent}%</td></tr>`;
    })
    .join('');
  return `
    <section class="stat-card">
      <h4>${escapeHtml(title)}</h4>
      <table class="table">
        <thead><tr><th>Value</th><th>Count</th><th>%</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>
  `;
}

function groupCount(items, field) {
  return items.reduce((acc, item) => {
    const key = item[field] || 'Unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

async function exportExamToPdf() {
  if (!generatedExam) return;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  const preview = dom.examPreview;
  if (!preview) return;

  const canvas = await html2canvas(preview, { scale: 2 });
  const imgData = canvas.toDataURL('image/png');
  const imgProps = pdf.getImageProperties(imgData);
  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
  pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
  pdf.save(`${sanitizeFileName(generatedExam.title || 'exam')}.pdf`);
}

function sanitizeFileName(name) {
  return name.replace(/[^a-z0-9-_]/gi, '_');
}

function setupEventHandlers() {
  dom.importForm.addEventListener('submit', handleImportSubmit);
  dom.generateForm.addEventListener('submit', handleGenerateSubmit);
  dom.searchForm.addEventListener('submit', handleSearchSubmit);
  dom.resetImport = document.getElementById('resetImport');
  dom.resetImport.addEventListener('click', resetImportForm);
  dom.refreshTypes.addEventListener('click', refreshTypeControls);
  dom.refreshDifficulty.addEventListener('click', refreshDifficultyControls);
  dom.exportPdf.addEventListener('click', exportExamToPdf);
  dom.printExam.addEventListener('click', () => window.print());
  dom.showQuestionIds.addEventListener('change', () => {
    showIdsToggle = dom.showQuestionIds.checked;
    renderExamPreview();
  });
  dom.includeAnswers.addEventListener('change', () => {
    includeAnswersToggle = dom.includeAnswers.checked;
    renderExamPreview();
  });
}

function applyInitialValues() {
  document.getElementById('examTitle').value = `Generated exam ${dayjs().format('YYYY-MM-DD')}`;
  document.getElementById('examInstructions').value =
    'Answer all questions. Circle the best answer for MCQ items and provide complete responses for constructed questions.';
}

export async function initApp({ supabaseUrl, supabaseKey } = {}) {
  cacheDomElements();
  setupNavigation();
  setupEventHandlers();
  applyInitialValues();
  examHistory = loadHistory();
  renderHistory();

  const missingCredentials =
    !supabaseUrl ||
    !supabaseKey ||
    `${supabaseUrl}`.trim() === PLACEHOLDER_URL ||
    `${supabaseKey}`.trim() === PLACEHOLDER_KEY;

  if (missingCredentials) {
    setConnectionStatus('Missing Supabase credentials', 'error');
    dom.importForm.querySelector('button[type="submit"]').disabled = true;
    dom.generateForm.querySelector('button[type="submit"]').disabled = true;
    return;
  }

  supabaseClient = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
    },
  });

  const connectionOk = await testConnection();
  dom.importForm.querySelector('button[type="submit"]').disabled = false;
  dom.generateForm.querySelector('button[type="submit"]').disabled = false;
  if (!connectionOk) {
    return;
  }

  await fetchAllQuestions();
  await refreshTypeControls();
  await refreshDifficultyControls();
  renderGlobalStatistics();
}
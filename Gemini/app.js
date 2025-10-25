// --- Configuration is now in config.js ---

// --- Initialize Supabase client ---
let supabaseClient;
try {
    if (typeof SUPABASE_URL === 'undefined' || typeof SUPABASE_ANON_KEY === 'undefined') { throw new Error("Supabase config (URL or Key) not found. Check config.js."); }
    if (typeof supabase === 'undefined' || typeof supabase.createClient !== 'function') { throw new Error("Supabase library not loaded correctly. Check index.html."); }
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log("Supabase client initialized."); // Log success
    if (!SUPABASE_URL.startsWith('http')) { throw new Error("Supabase URL must start with http or https."); }
} catch (error) {
    console.error("CRITICAL Error initializing Supabase:", error); // Log error
    document.addEventListener('DOMContentLoaded', () => { /* Display error message */ }); // Truncated
    try { /* Disable buttons */ } catch(e){} // Truncated
}

// --- DOM Elements ---
let courseSelect, typeFilterDiv, difficultyCheckboxes, topicIncludeInput, topicExcludeInput, tagsIncludeInput, searchTextInput, maxQuestionsInput, shuffleMcqCheckbox, showRefIdCheckbox, generateBtn, pdfBtn, examOutputDiv, studentOutputDiv, answerOutputDiv, statusDiv;

function getDomElements() { /* ... unchanged ... */ } // Truncated

// --- Global Variable ---
let currentExamQuestions = [];

// --- Functions ---
function displayStatus(message, isError = false) { /* ... unchanged ... */ }
function parseFilterList(inputString) { /* ... unchanged ... */ }
function shuffleArray(array) { /* ... unchanged ... */ }

// --- loadCourses with ENHANCED LOGGING ---
async function loadCourses() {
    console.log("loadCourses: Function started."); // Log entry
    if (!supabaseClient) { console.error("loadCourses: Supabase client not available."); return; }
    if (!courseSelect) { console.error("loadCourses: Course select element not found."); return; }

    try {
        displayStatus("Loading courses...");
        console.log("loadCourses: Querying Supabase for courses...");
        const { data, error } = await supabaseClient
            .from('questions')
            .select('course'); // Select only the course column

        if (error) {
            console.error("loadCourses: Supabase query error:", error);
            throw error; // Rethrow to be caught by catch block
        }
        if (!data) {
             console.warn("loadCourses: Supabase returned null data.");
             displayStatus("No courses found in database (null data).", false);
             return;
        }
        if (data.length === 0) {
             console.warn("loadCourses: Supabase returned empty data array.");
             displayStatus("No courses found in database (empty array).", false);
             return;
        }

        console.log("loadCourses: Raw course data received:", JSON.stringify(data)); // Log raw data stringified

        courseSelect.length = 1; // Clear existing options

        const courses = [...new Set(
            data
            .map(item => item?.course) // Use optional chaining just in case
            .filter(course => course && typeof course === 'string' && course.trim() !== '') // More robust filtering
        )].sort();

        console.log("loadCourses: Processed unique courses:", courses); // Log processed list

        if (courses.length === 0) {
            console.warn("loadCourses: No valid, unique courses found after processing.");
            displayStatus("No valid course names found.", false);
            return;
        }

        courses.forEach((course, index) => {
            console.log(`loadCourses: Adding option ${index + 1}: ${course}`); // Log each option added
            const option = document.createElement('option');
            option.value = course;
            option.textContent = course;
            courseSelect.appendChild(option);
        });
        displayStatus("Courses loaded.", false);
        console.log("loadCourses: Finished adding options.");

    } catch (error) {
        // Catch block will now catch query errors too
        console.error("loadCourses: CATCH block - Error loading courses:", error);
        displayStatus(`Error loading courses: ${error.message}`, true);
    }
}
// --- END loadCourses ---


async function loadTypes() {
    // ... (Keep previous version or add similar logging if needed) ...
     if (!supabaseClient || !typeFilterDiv) { console.error("Missing Supabase client or type filter element."); return; }
    try {
        displayStatus("Loading question types...");
        const { data, error } = await supabaseClient.from('questions').select('question_type');
        if (error) throw error;
        if (!data) { displayStatus("No question types found.", false); return; }
        // console.log("Raw type data:", data); // Optional logging
        typeFilterDiv.innerHTML = '';
        const types = [...new Set(data.map(item => item.question_type).filter(Boolean))].sort();
        // console.log("Processed types:", types); // Optional logging
        types.forEach(type => { const label = document.createElement('label'); const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.name = 'question_type'; checkbox.value = type; label.appendChild(checkbox); label.appendChild(document.createTextNode(` ${type}`)); typeFilterDiv.appendChild(label); });
         displayStatus("Question types loaded.", false);
    } catch (error) { console.error("Error loading types:", error); displayStatus(`Error loading question types: ${error.message}`, true); }
}

const difficultyMap = { easy: ['Very Easy', 'Easy'], medium: ['Medium'], hard: ['Hard', 'Very Hard'] };

async function generateExam() { /* ... unchanged ... */ }
function renderExamHTML(questions) { /* ... unchanged ... */ }
async function exportToPDF() { /* ... unchanged ... */ }

// --- Event Listeners and Initial Load ---
document.addEventListener('DOMContentLoaded', () => { /* ... unchanged ... */ });
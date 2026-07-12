'use strict';

/* =========================================================
   CONFIGURATION
========================================================= */

const API_URL =
  'https://script.google.com/macros/s/AKfycbyAvyBkU_vyyHwy5ekl3GIohGkA91WXL8sYIEmoaEEikGoWl7gr-OtUxfECO4fqia2Zfg/exec';

const MAX_ATTEMPTS = 3;
const WORD_SYSTEM_FULL_SCORE = 40;
const ARTICLE_SYSTEM_FULL_SCORE = 60;
const GRAND_TOTAL_FULL_SCORE = 100;

/* =========================================================
   GLOBAL STATE
========================================================= */

let sessionToken = '';
let student = null;

/* ระบบที่ 1: อ่านคำ 20 คำ */
let words = [];
let currentIndex = 0;
let currentAttempt = 1;
let wordSystemPoints = [];
let recognizer = null;
let assessmentInProgress = false;

/* ระบบที่ 2: อ่านบทความต่อเนื่อง */
let articleWords = [];
let articleSystemPoints = [];
let articleRecognizer = null;
let articleRecognitionResults = [];
let articleAssessmentInProgress = false;
let articleFinalizeStarted = false;
let articleAttempt = 1;
let articleWordElements = [];
let articleConfirmedTranscript = '';
let articleLiveTranscript = '';
let articleHighlightIndex = -1;
/* =========================================================
   INITIALIZATION
========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  const studentIdInput = document.getElementById('studentId');

  if (studentIdInput) {
    studentIdInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        login();
      }
    });
  }

  showView('loginView');
});

/* =========================================================
   JSONP API
========================================================= */

function callApi(action, data = {}) {
  return new Promise((resolve, reject) => {
    const callbackName =
      'jsonpCallback_' +
      Date.now() +
      '_' +
      Math.floor(Math.random() * 100000);

    const params = new URLSearchParams({
      action,
      callback: callbackName
    });

    Object.entries(data).forEach(([key, value]) => {
      params.set(
        key,
        typeof value === 'object'
          ? JSON.stringify(value)
          : String(value)
      );
    });

    const script = document.createElement('script');

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('เชื่อมต่อระบบหลังบ้านหมดเวลา'));
    }, 20000);

    function cleanup() {
      clearTimeout(timer);

      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }

      delete window[callbackName];
    }

    window[callbackName] = response => {
      cleanup();

      if (!response || !response.success) {
        reject(
          new Error(
            response?.message ||
            'ระบบหลังบ้านตอบกลับไม่สำเร็จ'
          )
        );
        return;
      }

      resolve(response.data);
    };

    script.onerror = () => {
      cleanup();
      reject(
        new Error('ไม่สามารถเชื่อมต่อ Google Apps Script')
      );
    };

    script.src = API_URL + '?' + params.toString();
    document.body.appendChild(script);
  });
}

/* =========================================================
   LOGIN AND MENU
========================================================= */

async function login() {
  const input = document.getElementById('studentId');
  const button = document.getElementById('loginBtn');
  const id = String(input?.value || '').trim();

  if (!id) {
    Swal.fire({
      icon: 'warning',
      title: 'กรุณากรอกรหัสนักศึกษา'
    });
    return;
  }

  setButton(button, true, 'กำลังตรวจสอบ...');

  try {
    const result = await callApi('login', {
      studentId: id
    });

    if (!result?.success) {
      throw new Error(
        result?.message || 'ไม่พบข้อมูลนักศึกษา'
      );
    }

    sessionToken = result.sessionToken;
    student = result;

    setText(
      'studentName',
      result.name || result.studentId || '—'
    );

    setText(
      'studentLevel',
      result.level || ''
    );

    setText(
      'menuStudentName',
      result.name || result.studentId || '—'
    );

    showView('menuView');

  } catch (error) {
    setMicIcon(false);
    showError(error);

  } finally {
    setButton(button, false, 'เข้าสู่ระบบ');
  }
}

async function startWordTest() {
  await loadWords();
}

function startArticleTest() {
  setText(
    'articleStudentName',
    student?.name || student?.studentId || '—'
  );

  setText(
    'articleStudentLevel',
    student?.level || ''
  );

  articleWords = Array.from(
    document.querySelectorAll(
      '#articleContent [data-target]'
    )
  ).map((element, index) => ({
    articleWordId:
      'A' + String(index + 1).padStart(3, '0'),

    word: String(
      element.getAttribute('data-target') ||
      element.textContent ||
      ''
    ).trim(),

    element
  }));

  if (articleWords.length !== 20) {
    Swal.fire({
      icon: 'warning',
      title: 'จำนวนคำในบทความไม่ครบ',
      text:
        `พบคำเป้าหมาย ${articleWords.length} คำ ` +
        'ต้องมีทั้งหมด 20 คำ'
    });
    return;
  }

articleSystemPoints = [];
articleRecognitionResults = [];
articleAssessmentInProgress = false;
articleFinalizeStarted = false;
articleAttempt = 1;

prepareArticleWordHighlight();
resetArticleContinuousUI();
showView('articleView');
}

/* =========================================================
   VIEW MANAGEMENT
========================================================= */

function showView(id) {
  [
    'loginView',
    'menuView',
    'testView',
    'articleView',
    'summaryView'
  ].forEach(viewId => {
    const element = document.getElementById(viewId);

    if (element) {
      element.classList.toggle(
        'hidden',
        viewId !== id
      );
    }
  });

  const micTestArea =
    document.getElementById('micTestArea');

  if (micTestArea) {
    const shouldShow =
      id === 'testView' ||
      id === 'articleView';

    micTestArea.classList.toggle(
      'hidden',
      !shouldShow
    );
  }
}

/* =========================================================
   SYSTEM 1: WORD TEST
========================================================= */

async function loadWords() {
  Swal.fire({
    title: 'กำลังเตรียมแบบทดสอบ',
    allowOutsideClick: false,
    didOpen: () => Swal.showLoading()
  });

  try {
    const result = await callApi('getWords', {
      sessionToken
    });

    words = Array.isArray(result) ? result : [];

    if (!words.length) {
      throw new Error(
        'ไม่พบคำทดสอบ กรุณาเพิ่มคำในชีต words'
      );
    }

    currentIndex = 0;
    currentAttempt = 1;
    wordSystemPoints = [];

    Swal.close();
    showView('testView');
    renderWord();

  } catch (error) {
    Swal.close();
    setMicIcon(false);
    showError(error);
  }
}

function renderWord() {
  const item = words[currentIndex];

  if (!item) {
    showWordSummary();
    return;
  }

  const percent =
    ((currentIndex + 1) / words.length) * 100;

  setText(
    'counter',
    `คำที่ ${currentIndex + 1} จาก ${words.length}`
  );

  const progressBar =
    document.getElementById('progressBar');

  if (progressBar) {
    progressBar.style.width = percent + '%';
  }

  setText('wordText', item.word || '');

  setText(
    'wordMeta',
    [item.level, item.category]
      .filter(Boolean)
      .join(' • ')
  );

  const resultBox =
    document.getElementById('resultBox');

  if (resultBox) {
    resultBox.classList.add('hidden');
  }

  const micCircle =
    document.getElementById('micCircle');

  if (micCircle) {
    micCircle.classList.remove('listening');
  }

  setMicIcon(false);

  setText(
    'statusText',
    'เมื่อพร้อม ให้กดไมโครโฟนแล้วอ่านคำที่แสดง'
  );

  setButton(
    document.getElementById('recordBtn'),
    false,
    'กดไมโครโฟนเพื่อเริ่มอ่าน'
  );
}

async function startAssessment() {
  if (assessmentInProgress) return;

  if (!words[currentIndex]) {
    Swal.fire({
      icon: 'warning',
      title: 'ไม่พบคำที่ต้องอ่าน'
    });
    return;
  }

  if (!ensureSpeechSdk()) return;
  if (!ensureMicrophoneSupport()) return;

  try {
    setText(
      'statusText',
      'กำลังขออนุญาตใช้ไมโครโฟน...'
    );

    await requestMicrophonePermission();

  } catch (error) {
    showMicrophoneError(error, 'statusText');
    return;
  }

  assessmentInProgress = true;

  setButton(
    document.getElementById('recordBtn'),
    true,
    'กำลังเตรียม...'
  );

  setText(
    'statusText',
    'กำลังเชื่อมต่อระบบวิเคราะห์เสียง...'
  );

  try {
    const auth = await callApi('getAzureToken', {
      sessionToken
    });

    beginAzureWordAssessment(auth);

  } catch (error) {
    assessmentInProgress = false;
    resetRecorderUI();
    showError(error);
  }
}

function beginAzureWordAssessment(auth) {
  try {
    const item = words[currentIndex];

    if (!auth?.token || !auth?.region) {
      throw new Error('ข้อมูล Azure Token ไม่สมบูรณ์');
    }

    const speechConfig =
      SpeechSDK.SpeechConfig.fromAuthorizationToken(
        auth.token,
        auth.region
      );

    speechConfig.speechRecognitionLanguage = 'th-TH';
    speechConfig.outputFormat =
      SpeechSDK.OutputFormat.Detailed;

    speechConfig.setProperty(
      SpeechSDK.PropertyId
        .SpeechServiceConnection_InitialSilenceTimeoutMs,
      '5000'
    );

    speechConfig.setProperty(
      SpeechSDK.PropertyId
        .SpeechServiceConnection_EndSilenceTimeoutMs,
      '1200'
    );

    const audioConfig =
      SpeechSDK.AudioConfig
        .fromDefaultMicrophoneInput();

    recognizer =
      new SpeechSDK.SpeechRecognizer(
        speechConfig,
        audioConfig
      );

    const pronunciationConfig =
      new SpeechSDK.PronunciationAssessmentConfig(
        item.word,
        SpeechSDK
          .PronunciationAssessmentGradingSystem
          .HundredMark,
        SpeechSDK
          .PronunciationAssessmentGranularity
          .Word,
        true
      );

    pronunciationConfig.applyTo(recognizer);

    const micCircle =
      document.getElementById('micCircle');

    if (micCircle) {
      micCircle.classList.add('listening');
    }

    setMicIcon(true);

    setButton(
      document.getElementById('recordBtn'),
      true,
      'กำลังฟังเสียง...'
    );

    setText(
      'statusText',
      `กรุณาอ่านคำว่า “${item.word}”`
    );

    recognizer.recognizeOnceAsync(
      result => {
        closeRecognizer();
        assessmentInProgress = false;
        handleWordRecognition(result);
      },

      error => {
        closeRecognizer();
        assessmentInProgress = false;
        resetRecorderUI();

        Swal.fire({
          icon: 'error',
          title: 'วิเคราะห์เสียงไม่สำเร็จ',
          text: String(error || 'เกิดข้อผิดพลาด')
        });
      }
    );

  } catch (error) {
    closeRecognizer();
    assessmentInProgress = false;
    resetRecorderUI();
    showError(error);
  }
}

function handleWordRecognition(result) {
  resetRecorderUI();

  if (
    result.reason ===
    SpeechSDK.ResultReason.RecognizedSpeech
  ) {
    const assessment =
      SpeechSDK.PronunciationAssessmentResult
        .fromResult(result);

    const data = {
      recognizedText:
        cleanRecognized(result.text),

      accuracy:
        safeScore(assessment.accuracyScore),

      fluency:
        safeScore(assessment.fluencyScore),

      completeness:
        safeScore(assessment.completenessScore),

      pronunciation:
        safeScore(assessment.pronunciationScore)
    };

    data.finalScore = round2(
      data.accuracy * 0.85 +
      data.pronunciation * 0.15
    );

    data.point =
      calculateWordPoint(data.finalScore);

    wordSystemPoints[currentIndex] =
      data.point;

    data.accumulatedPoint =
      sumPoints(wordSystemPoints);

    showWordResult(data);
    saveWordResult(data);
    return;
  }

  if (
    result.reason ===
    SpeechSDK.ResultReason.NoMatch
  ) {
    Swal.fire({
      icon: 'warning',
      title: 'ไม่ได้ยินเสียงชัดเจน',
      text:
        'กรุณาเข้าใกล้ไมโครโฟนและอ่านอีกครั้ง'
    });
    return;
  }

  if (
    result.reason ===
    SpeechSDK.ResultReason.Canceled
  ) {
    const detail =
      SpeechSDK.CancellationDetails
        .fromResult(result);

    Swal.fire({
      icon: 'error',
      title: 'การวิเคราะห์ถูกยกเลิก',
      text:
        detail.errorDetails ||
        String(detail.reason || 'กรุณาลองใหม่')
    });
    return;
  }

  Swal.fire({
    icon: 'warning',
    title: 'ไม่สามารถอ่านผลเสียงได้',
    text: 'กรุณาลองใหม่อีกครั้ง'
  });
}

function showWordResult(data) {
  const currentWord =
    words[currentIndex]?.word || '—';

  Swal.fire({
    title: 'ผลการอ่านออกเสียง',
    width: 620,
    allowOutsideClick: false,

    showCancelButton:
      currentAttempt < MAX_ATTEMPTS,

    cancelButtonText: 'อ่านอีกครั้ง',

    confirmButtonText:
      currentIndex === words.length - 1
        ? 'ดูผลสรุป'
        : 'คำถัดไป',

    html: `
      <div class="popup-result">

        <div class="popup-point-summary">

          <div class="popup-point-item">
            <span class="popup-point-title">
              คะแนน
            </span>

            <b class="popup-point-number">
              ${formatPoint(data.point)}
            </b>

            <small class="popup-point-full">
              เต็ม 2 คะแนน
            </small>
          </div>

          <div class="popup-point-item">
            <span class="popup-point-title">
              คะแนนสะสม
            </span>

            <b class="popup-point-number">
              ${formatPoint(
                data.accumulatedPoint
              )}
            </b>

            <small class="popup-point-full">
              เต็ม ${WORD_SYSTEM_FULL_SCORE} คะแนน
            </small>
          </div>

        </div>

        <div class="popup-word">
          คำที่ประเมิน:
          <strong>
            ${escapeHtml(currentWord)}
          </strong>
        </div>

        <div class="popup-score">
          ${Math.round(data.finalScore)}%
        </div>

        <div class="popup-status">
          ${statusText(data.finalScore)}
        </div>

        <div class="popup-score-grid">
          <div>
            <b>${Math.round(data.accuracy)}</b>
            <span>ความถูกต้อง</span>
          </div>

          <div>
            <b>
              ${Math.round(data.pronunciation)}
            </b>
            <span>การออกเสียง</span>
          </div>

          <div>
            <b>${Math.round(data.fluency)}</b>
            <span>ความคล่อง</span>
          </div>

          <div>
            <b>
              ${Math.round(data.completeness)}
            </b>
            <span>ความครบถ้วน</span>
          </div>
        </div>

      </div>
    `
  }).then(result => {
    if (result.isConfirmed) {
      nextWord();
      return;
    }

    if (
      result.dismiss ===
      Swal.DismissReason.cancel
    ) {
      retryCurrentWord();
    }
  });
}

async function saveWordResult(data) {
  const item = words[currentIndex];
  const savedIndex = currentIndex;
  const savedAttempt = currentAttempt;

  if (!item) return;

  const payload = {
    wordId: item.wordId,
    referenceWord: item.word,
    recognizedText: data.recognizedText,
    accuracy: data.accuracy,
    fluency: data.fluency,
    completeness: data.completeness,
    pronunciation: data.pronunciation,
    point: data.point,
    accumulatedPoint: data.accumulatedPoint,
    fullPoint: WORD_SYSTEM_FULL_SCORE,
    attempt: savedAttempt
  };

  try {
    const result = await callApi('saveResult', {
      sessionToken,
      payload
    });

    if (
      result?.success &&
      Number.isFinite(Number(result.point))
    ) {
      wordSystemPoints[savedIndex] =
        Number(result.point);
    }

  } catch (error) {
    console.error(
      'บันทึกผลอ่านคำไม่สำเร็จ',
      error
    );

    showSaveWarning(
      'แสดงผลได้ แต่บันทึกลงชีตไม่สำเร็จ'
    );
  }
}

function retryCurrentWord() {
  if (currentAttempt >= MAX_ATTEMPTS) {
    Swal.fire({
      icon: 'info',
      title: 'อ่านครบจำนวนครั้งแล้ว',
      text:
        `คำนี้อ่านได้สูงสุด ` +
        `${MAX_ATTEMPTS} ครั้ง`
    });
    return;
  }

  currentAttempt++;

  setText(
    'statusText',
    `ครั้งที่ ${currentAttempt} จาก ` +
    `${MAX_ATTEMPTS} — กดไมโครโฟนเพื่ออ่านอีกครั้ง`
  );

  setButton(
    document.getElementById('recordBtn'),
    false,
    'กดไมโครโฟนเพื่ออ่านอีกครั้ง'
  );

  setMicIcon(false);
}

function nextWord() {
  if (currentIndex >= words.length - 1) {
    showWordSummary();
    return;
  }

  currentIndex++;
  currentAttempt = 1;
  renderWord();
}

function showWordSummary() {
  closeRecognizer();
  showView('summaryView');

  const totalPoint =
    sumPoints(wordSystemPoints);

  const averageScore =
    document.getElementById('averageScore');

  if (averageScore) {
    averageScore.textContent =
      formatPoint(totalPoint) +
      ` / ${WORD_SYSTEM_FULL_SCORE} คะแนน`;
  }
}

/* =========================================================
   SYSTEM 2: CONTINUOUS ARTICLE READING
========================================================= */

async function startContinuousArticleAssessment() {
  if (articleAssessmentInProgress) return;

  if (!ensureSpeechSdk()) return;
  if (!ensureMicrophoneSupport()) return;

  if (articleWords.length !== 20) {
    startArticleTest();

    if (articleWords.length !== 20) {
      return;
    }
  }

  // เริ่มการอ่านใหม่ ให้สีเริ่มจากต้นบทความ
  resetArticleWordHighlight();

  try {
    setText(
      'articleStatusText',
      'กำลังขออนุญาตใช้ไมโครโฟน...'
    );

    await requestMicrophonePermission();

    const auth =
      await callApi('getAzureToken', {
        sessionToken
      });

    beginContinuousArticleAzure(auth);

  } catch (error) {
    articleAssessmentInProgress = false;
    resetArticleContinuousUI();

    Swal.fire({
      icon: 'error',
      title: 'ไม่สามารถเริ่มอ่านบทความได้',
      text:
        error?.message ||
        String(error)
    });
  }
}

function beginContinuousArticleAzure(auth) {
  const articleElement =
    document.getElementById('articleContent');

  const referenceText =
    normalizeWhitespace(
      articleElement?.textContent || ''
    );

  if (!referenceText) {
    throw new Error('ไม่พบข้อความบทความ');
  }

  if (!auth?.token || !auth?.region) {
    throw new Error('ข้อมูล Azure Token ไม่สมบูรณ์');
  }

  closeArticleRecognizer(false);

  articleRecognitionResults = [];
  articleFinalizeStarted = false;
  articleAssessmentInProgress = true;

  const speechConfig =
    SpeechSDK.SpeechConfig.fromAuthorizationToken(
      auth.token,
      auth.region
    );

  speechConfig.speechRecognitionLanguage = 'th-TH';
  speechConfig.outputFormat =
    SpeechSDK.OutputFormat.Detailed;

  speechConfig.setProperty(
    SpeechSDK.PropertyId
      .SpeechServiceConnection_InitialSilenceTimeoutMs,
    '10000'
  );

  speechConfig.setProperty(
    SpeechSDK.PropertyId
      .SpeechServiceConnection_EndSilenceTimeoutMs,
    '3000'
  );

  const audioConfig =
    SpeechSDK.AudioConfig
      .fromDefaultMicrophoneInput();

  articleRecognizer =
    new SpeechSDK.SpeechRecognizer(
      speechConfig,
      audioConfig
    );

  const pronunciationConfig =
    new SpeechSDK.PronunciationAssessmentConfig(
      referenceText,
      SpeechSDK
        .PronunciationAssessmentGradingSystem
        .HundredMark,
      SpeechSDK
        .PronunciationAssessmentGranularity
        .Word,
      false
    );

  pronunciationConfig.applyTo(articleRecognizer);

articleRecognizer.recognizing = (
  sender,
  event
) => {
  articleLiveTranscript =
    String(
      event?.result?.text || ''
    ).trim();

  const fullTranscript =
    (
      articleConfirmedTranscript +
      ' ' +
      articleLiveTranscript
    ).trim();

  updateArticleWordHighlight(
    fullTranscript
  );

  setText(
    'articleStatusText',
    'กำลังฟังและติดตามตำแหน่งการอ่าน...'
  );
};

  articleRecognizer.recognized = (
    sender,
    event
  ) => {
    if (
      event.result.reason !==
      SpeechSDK.ResultReason.RecognizedSpeech
    ) {
      return;
    }
const confirmedText =
  String(
    event?.result?.text || ''
  ).trim();

if (confirmedText) {
  articleConfirmedTranscript =
    (
      articleConfirmedTranscript +
      ' ' +
      confirmedText
    ).trim();

  articleLiveTranscript = '';

  updateArticleWordHighlight(
    articleConfirmedTranscript
  );
}
    const jsonText =
      event.result.properties.getProperty(
        SpeechSDK.PropertyId
          .SpeechServiceResponse_JsonResult
      );

    if (!jsonText) return;

    try {
      articleRecognitionResults.push(
        JSON.parse(jsonText)
      );
    } catch (error) {
      console.error(
        'อ่านผล Azure JSON ไม่สำเร็จ',
        error
      );
    }
  };

  articleRecognizer.canceled = (
    sender,
    event
  ) => {
    articleAssessmentInProgress = false;

    if (
      articleFinalizeStarted ||
      event.reason ===
        SpeechSDK.CancellationReason.EndOfStream
    ) {
      return;
    }

    resetArticleContinuousUI();

    Swal.fire({
      icon: 'error',
      title: 'การวิเคราะห์ถูกยกเลิก',
      text:
        event.errorDetails ||
        String(event.reason || '')
    });
  };

  articleRecognizer.sessionStopped = () => {
    if (
      articleAssessmentInProgress &&
      !articleFinalizeStarted
    ) {
      articleAssessmentInProgress = false;
      finalizeArticleAssessment();
    }
  };

  const micCircle =
    document.getElementById('articleMicCircle');

  if (micCircle) {
    micCircle.classList.add('listening');
  }

  setArticleMicIcon(true);

  const stopButton =
    document.getElementById('stopArticleBtn');

  if (stopButton) {
    stopButton.classList.remove('hidden');
  }

  setText(
    'articleStatusText',
    'กำลังฟัง กรุณาอ่านบทความต่อเนื่องจนจบ'
  );

  articleRecognizer.startContinuousRecognitionAsync(
    () => {},
    error => {
      articleAssessmentInProgress = false;
      closeArticleRecognizer();
      showError(error);
    }
  );
}
function prepareArticleWordHighlight() {
  const container =
    document.getElementById('articleContent');

  if (!container) return;

  if (
    container.dataset.wordHighlightPrepared === 'true'
  ) {
    articleWordElements = Array.from(
      container.querySelectorAll(
        '.article-reading-word'
      )
    );

    resetArticleWordHighlight();
    return;
  }

  const textNodes = [];

  const walker =
    document.createTreeWalker(
      container,
      NodeFilter.SHOW_TEXT
    );

  while (walker.nextNode()) {
    const node = walker.currentNode;

    if (
      node.nodeValue &&
      node.nodeValue.trim()
    ) {
      textNodes.push(node);
    }
  }

  const segmenter =
    typeof Intl !== 'undefined' &&
    typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter('th', {
          granularity: 'word'
        })
      : null;

  textNodes.forEach(textNode => {
    const fragment =
      document.createDocumentFragment();

    const originalText =
      textNode.nodeValue;

    if (segmenter) {
      const segments =
        Array.from(
          segmenter.segment(originalText)
        );

      segments.forEach(segmentInfo => {
        const text =
          segmentInfo.segment;

        if (!text) return;

        if (
          !segmentInfo.isWordLike ||
          /^\s+$/.test(text)
        ) {
          fragment.appendChild(
            document.createTextNode(text)
          );
          return;
        }

        const span =
          document.createElement('span');

        span.className =
          'article-reading-word';

        span.textContent = text;

        span.dataset.normalizedWord =
          normalizeThaiWord(text);

        fragment.appendChild(span);
      });

    } else {
      /*
       * Fallback สำหรับเบราว์เซอร์เก่า
       * จะแบ่งตามช่องว่าง
       */
      originalText
        .split(/(\s+)/)
        .forEach(part => {
          if (!part) return;

          if (/^\s+$/.test(part)) {
            fragment.appendChild(
              document.createTextNode(part)
            );
            return;
          }

          const span =
            document.createElement('span');

          span.className =
            'article-reading-word';

          span.textContent = part;

          span.dataset.normalizedWord =
            normalizeThaiWord(part);

          fragment.appendChild(span);
        });
    }

    textNode.parentNode.replaceChild(
      fragment,
      textNode
    );
  });

  container.dataset.wordHighlightPrepared =
    'true';

  articleWordElements = Array.from(
    container.querySelectorAll(
      '.article-reading-word'
    )
  );

  resetArticleWordHighlight();
}
function resetArticleWordHighlight() {
  articleConfirmedTranscript = '';
  articleLiveTranscript = '';
  articleHighlightIndex = -1;

  articleWordElements.forEach(element => {
    element.classList.remove(
      'article-read',
      'article-current'
    );
  });
}
function getSpokenArticleWords(text) {
  const source = String(text || '')
    .normalize('NFC')
    .trim();

  if (!source) return [];

  if (
    typeof Intl !== 'undefined' &&
    typeof Intl.Segmenter === 'function'
  ) {
    const segmenter =
      new Intl.Segmenter('th', {
        granularity: 'word'
      });

    return Array.from(
      segmenter.segment(source)
    )
      .filter(item => item.isWordLike)
      .map(item =>
        normalizeThaiWord(item.segment)
      )
      .filter(Boolean);
  }

  // สำหรับเบราว์เซอร์รุ่นเก่า
  return source
    .split(/\s+/)
    .map(normalizeThaiWord)
    .filter(Boolean);
}

function findArticleWordPosition(spokenText) {
  const spokenWords =
    getSpokenArticleWords(spokenText);

  if (!spokenWords.length) {
    return -1;
  }

  let referenceIndex = 0;
  let lastMatchedIndex = -1;

  for (
    let spokenIndex = 0;
    spokenIndex < spokenWords.length;
    spokenIndex++
  ) {
    const spokenWord =
      spokenWords[spokenIndex];

    let foundIndex = -1;

const searchLimit =
  Math.min(
    articleWordElements.length,
    referenceIndex + 30
  );

    for (
      let index = referenceIndex;
      index < searchLimit;
      index++
    ) {
      const referenceWord =
        articleWordElements[index]
          .dataset.normalizedWord || '';

      if (
        referenceWord === spokenWord
      ) {
        foundIndex = index;
        break;
      }
    }

    if (foundIndex !== -1) {
      lastMatchedIndex = foundIndex;
      referenceIndex = foundIndex + 1;
    }
  }

  return lastMatchedIndex;
}
function updateArticleWordHighlight(
  spokenText
) {
  const matchedIndex =
    findArticleWordPosition(
      spokenText
    );

  if (matchedIndex < 0) return;

  /*
   * ไม่ให้ตำแหน่งไฮไลต์ย้อนกลับ
   */
  articleHighlightIndex =
    Math.max(
      articleHighlightIndex,
      matchedIndex
    );

  articleWordElements.forEach(
    (element, index) => {
      element.classList.remove(
        'article-current'
      );

      element.classList.toggle(
        'article-read',
        index < articleHighlightIndex
      );

      if (
        index === articleHighlightIndex
      ) {
        element.classList.add(
          'article-current'
        );

        element.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest'
        });
      }
    }
  );
}
function stopContinuousArticleAssessment() {
  if (!articleRecognizer) {
    Swal.fire({
      icon: 'warning',
      title: 'ระบบยังไม่ได้เริ่มฟังเสียง'
    });
    return;
  }

  setText(
    'articleStatusText',
    'กำลังหยุดและประมวลผล...'
  );

  const stopButton =
    document.getElementById('stopArticleBtn');

  if (stopButton) {
    stopButton.classList.add('hidden');
  }

  const currentRecognizer =
    articleRecognizer;

  currentRecognizer
    .stopContinuousRecognitionAsync(
      () => {
        if (
          articleRecognizer ===
          currentRecognizer
        ) {
          try {
            currentRecognizer.close();
          } catch (error) {
            console.error(error);
          }

          articleRecognizer = null;
        }

        articleAssessmentInProgress = false;
        finalizeArticleAssessment();
      },

      error => {
        articleAssessmentInProgress = false;
        closeArticleRecognizer();
        showError(error);
      }
    );
}

function finalizeArticleAssessment() {
  if (articleFinalizeStarted) return;

  articleFinalizeStarted = true;
  articleAssessmentInProgress = false;

  resetArticleContinuousUI();

  const targetResults =
    evaluateArticleTargetWords();

  if (!targetResults.length) {
    articleFinalizeStarted = false;

    Swal.fire({
      icon: 'warning',
      title: 'ไม่พบผลการอ่าน',
      text:
        'ระบบยังไม่ได้รับข้อความจากเสียง ' +
        'กรุณาอ่านให้ชัดเจนแล้วลองใหม่'
    });
    return;
  }

  articleSystemPoints =
    targetResults.map(item => item.point);

  const articleTotal =
    round1(sumPoints(articleSystemPoints));

  const wordTotal =
    round1(sumPoints(wordSystemPoints));

  const grandTotal =
    round1(wordTotal + articleTotal);

  showContinuousArticleResult(
    targetResults,
    articleTotal,
    grandTotal
  );

  saveContinuousArticleResults(
    targetResults,
    articleTotal,
    grandTotal
  );
}

function evaluateArticleTargetWords() {
  const recognizedWords =
    collectRecognizedArticleWords();

  if (!recognizedWords.length) {
    return [];
  }

  return articleWords.map(target => {
    const normalizedTarget =
      normalizeThaiWord(target.word);

    const exactMatches =
      recognizedWords.filter(item =>
        item.word === normalizedTarget
      );

    const bestMatch =
      exactMatches.sort(
        (a, b) =>
          b.accuracy - a.accuracy
      )[0];

    const accuracy =
      bestMatch
        ? bestMatch.accuracy
        : 0;

    const point =
      calculateArticlePoint(accuracy);

    return {
      articleWordId:
        target.articleWordId,

      referenceWord:
        target.word,

      recognizedWord:
        bestMatch?.rawWord || '',

      accuracy,

      point,

      errorType:
        bestMatch
          ? bestMatch.errorType
          : 'Omission'
    };
  });
}

function collectRecognizedArticleWords() {
  const output = [];

  articleRecognitionResults.forEach(result => {
    const nBest =
      Array.isArray(result?.NBest)
        ? result.NBest
        : [];

    const best = nBest[0];

    const resultWords =
      Array.isArray(best?.Words)
        ? best.Words
        : [];

    resultWords.forEach(wordItem => {
      const rawWord =
        String(wordItem?.Word || '').trim();

      output.push({
        rawWord,

        word:
          normalizeThaiWord(rawWord),

        accuracy:
          safeScore(
            wordItem
              ?.PronunciationAssessment
              ?.AccuracyScore
          ),

        errorType:
          String(
            wordItem
              ?.PronunciationAssessment
              ?.ErrorType ||
            'None'
          )
      });
    });
  });

  return output;
}

function showContinuousArticleResult(
  results,
  articleTotal,
  grandTotal
) {
  const rows = results.map(
    (item, index) => `
      <tr>
        <td>${index + 1}</td>

        <td>
          ${escapeHtml(item.referenceWord)}
        </td>

        <td>
          ${Math.round(item.accuracy)}%
        </td>

        <td>
          ${formatPoint(item.point)} / 3
        </td>
      </tr>
    `
  ).join('');

  Swal.fire({
    title: 'ผลการอ่านบทความ',
    width: 760,
    allowOutsideClick: false,
    confirmButtonText: 'ดูผลสรุป',

    html: `
      <div class="popup-result">

        <div class="popup-point-summary">

          <div class="popup-point-item">
            <span class="popup-point-title">
              คะแนนบทความ
            </span>

            <b class="popup-point-number">
              ${formatPoint(articleTotal)}
            </b>

            <small class="popup-point-full">
              เต็ม ${ARTICLE_SYSTEM_FULL_SCORE} คะแนน
            </small>
          </div>

          <div class="popup-point-item">
            <span class="popup-point-title">
              คะแนนรวม
            </span>

            <b class="popup-point-number">
              ${formatPoint(grandTotal)}
            </b>

            <small class="popup-point-full">
              เต็ม ${GRAND_TOTAL_FULL_SCORE} คะแนน
            </small>
          </div>

        </div>

        <div class="article-result-table-wrap">
          <table class="article-result-table">
            <thead>
              <tr>
                <th>#</th>
                <th>คำเป้าหมาย</th>
                <th>ความถูกต้อง</th>
                <th>คะแนน</th>
              </tr>
            </thead>

            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>

      </div>
    `
  }).then(result => {
    if (result.isConfirmed) {
      showArticleSummary();
    }
  });
}

async function saveContinuousArticleResults(
  results,
  articleTotal,
  grandTotal
) {
  const requests = results.map(item => {
    const payload = {
      articleWordId:
        item.articleWordId,

      referenceWord:
        item.referenceWord,

      recognizedText:
        item.recognizedWord,

      accuracy:
        item.accuracy,

      fluency: 0,

      completeness:
        item.errorType === 'Omission'
          ? 0
          : 100,

      pronunciation:
        item.accuracy,

      finalScore:
        item.accuracy,

      point:
        item.point,

      accumulatedPoint:
        articleTotal,

      fullPoint:
        ARTICLE_SYSTEM_FULL_SCORE,

      grandTotalPoint:
        grandTotal,

      grandTotalFullPoint:
        GRAND_TOTAL_FULL_SCORE,

      attempt:
        articleAttempt,

      errorType:
        item.errorType
    };

    return callApi('saveArticleResult', {
      sessionToken,
      payload
    });
  });

  const settled =
    await Promise.allSettled(requests);

  const failedCount =
    settled.filter(
      item => item.status === 'rejected'
    ).length;

  if (failedCount > 0) {
    console.error(
      'บันทึกผลบทความไม่สำเร็จบางรายการ:',
      settled
    );

    showSaveWarning(
      `บันทึกผลบทความไม่สำเร็จ ` +
      `${failedCount} จาก ${results.length} รายการ`
    );
  }
}

function showArticleSummary() {
  closeArticleRecognizer();
  showView('summaryView');

  const articlePoint =
    round1(sumPoints(articleSystemPoints));

  const wordPoint =
    round1(sumPoints(wordSystemPoints));

  const grandTotal =
    round1(wordPoint + articlePoint);

  const averageScore =
    document.getElementById('averageScore');

  if (averageScore) {
    averageScore.innerHTML = `
      <div>
        อ่านคำ:
        ${formatPoint(wordPoint)}
        / ${WORD_SYSTEM_FULL_SCORE}
      </div>

      <div>
        อ่านบทความ:
        ${formatPoint(articlePoint)}
        / ${ARTICLE_SYSTEM_FULL_SCORE}
      </div>

      <div style="margin-top:12px;">
        รวม:
        ${formatPoint(grandTotal)}
        / ${GRAND_TOTAL_FULL_SCORE} คะแนน
      </div>
    `;
  }
}

function resetArticleContinuousUI() {
  const circle =
    document.getElementById('articleMicCircle');

  if (circle) {
    circle.classList.remove('listening');
  }

  setArticleMicIcon(false);

  const stopButton =
    document.getElementById('stopArticleBtn');

  if (stopButton) {
    stopButton.classList.add('hidden');
  }

  setText(
    'articleStatusText',
    'กดไมโครโฟน แล้วอ่านบทความทั้งหมดจนจบ ' +
    'จากนั้นกด “หยุดและประเมินผล”'
  );
}

function closeArticleRecognizer(
  resetUi = true
) {
  if (articleRecognizer) {
    try {
      articleRecognizer.close();
    } catch (error) {
      console.error(error);
    }

    articleRecognizer = null;
  }

  articleAssessmentInProgress = false;

  if (resetUi) {
    resetArticleContinuousUI();
  }
}

/* =========================================================
   MICROPHONE TEST
========================================================= */

async function testMicrophoneOnly() {
  try {
    await requestMicrophonePermission();

    Swal.fire({
      icon: 'success',
      title: 'ไมโครโฟนพร้อมใช้งาน',
      text:
        'เบราว์เซอร์อนุญาตให้ระบบใช้ไมโครโฟนแล้ว'
    });

  } catch (error) {
    Swal.fire({
      icon: 'error',
      title: 'ไมโครโฟนยังใช้งานไม่ได้',
      text:
        `${error?.name || 'Error'}: ` +
        `${error?.message || String(error)}`
    });
  }
}

/* =========================================================
   SHARED SCORING
========================================================= */

function calculateWordPoint(score) {
  score = Number(score) || 0;

  if (score >= 70) {
    return 2;
  }

  if (score >= 41) {
    const point =
      1.1 +
      ((score - 41) * 0.8 / 28);

    return round1(point);
  }

  if (score >= 40) {
    return 1;
  }

  if (score >= 11) {
    const point =
      0.1 +
      ((score - 11) * 0.8 / 28);

    return round1(point);
  }

  return 0;
}

function calculateArticlePoint(score) {
  const normalizedScore =
    Math.max(
      0,
      Math.min(
        100,
        Number(score) || 0
      )
    );

  return round1(
    (normalizedScore / 100) * 3
  );
}

function sumPoints(points) {
  return points.reduce(
    (total, point) =>
      total + (Number(point) || 0),
    0
  );
}

/* =========================================================
   SHARED MICROPHONE AND RECOGNIZER HELPERS
========================================================= */

function ensureSpeechSdk() {
  if (typeof SpeechSDK !== 'undefined') {
    return true;
  }

  Swal.fire({
    icon: 'error',
    title: 'โหลด Azure Speech SDK ไม่สำเร็จ',
    text: 'กรุณารีเฟรชหน้าเว็บแล้วลองใหม่'
  });

  return false;
}

function ensureMicrophoneSupport() {
  if (
    navigator.mediaDevices &&
    typeof navigator.mediaDevices
      .getUserMedia === 'function'
  ) {
    return true;
  }

  Swal.fire({
    icon: 'error',
    title: 'เบราว์เซอร์ไม่รองรับไมโครโฟน',
    text:
      'กรุณาเปิดระบบด้วย Google Chrome, ' +
      'Microsoft Edge หรือ Safari เวอร์ชันล่าสุด'
  });

  return false;
}

async function requestMicrophonePermission() {
  const stream =
    await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

  stream
    .getTracks()
    .forEach(track => track.stop());
}

function showMicrophoneError(
  error,
  statusElementId
) {
  console.error(
    'Microphone permission error:',
    error
  );

  let title =
    'ไม่สามารถใช้ไมโครโฟนได้';

  let message =
    'กรุณาตรวจสอบไมโครโฟนและลองใหม่';

  if (
    error?.name === 'NotAllowedError' ||
    error?.name === 'PermissionDeniedError'
  ) {
    message =
      'เบราว์เซอร์ไม่อนุญาตให้เว็บไซต์ใช้ไมโครโฟน ' +
      'กรุณาตั้งค่าไมโครโฟนเป็น “อนุญาต” แล้วรีเฟรชหน้าเว็บ';
  } else if (
    error?.name === 'NotFoundError' ||
    error?.name === 'DevicesNotFoundError'
  ) {
    message =
      'ไม่พบอุปกรณ์ไมโครโฟน กรุณาตรวจสอบอุปกรณ์เสียง';
  } else if (
    error?.name === 'NotReadableError' ||
    error?.name === 'TrackStartError'
  ) {
    message =
      'ไม่สามารถเปิดไมโครโฟนได้ ' +
      'อาจมีโปรแกรมอื่นกำลังใช้งานอยู่';
  } else if (
    error?.name === 'SecurityError'
  ) {
    message =
      'เบราว์เซอร์บล็อกไมโครโฟน ' +
      'กรุณาเปิดหน้า GitHub Pages โดยตรง';
  }

  Swal.fire({
    icon: 'warning',
    title,
    text: message,
    confirmButtonText: 'ตกลง'
  });

  setText(
    statusElementId,
    'ยังไม่ได้รับอนุญาตให้ใช้ไมโครโฟน'
  );
}

function resetRecorderUI() {
  const micCircle =
    document.getElementById('micCircle');

  if (micCircle) {
    micCircle.classList.remove('listening');
  }

  setMicIcon(false);

  setButton(
    document.getElementById('recordBtn'),
    false,
    'กดไมโครโฟนเพื่อเริ่มอ่าน'
  );

  setText(
    'statusText',
    'เมื่อพร้อม ให้กดไมโครโฟนแล้วอ่านคำที่แสดง'
  );
}

function closeRecognizer() {
  if (recognizer) {
    try {
      recognizer.close();
    } catch (error) {
      console.error(error);
    }

    recognizer = null;
  }

  assessmentInProgress = false;
  resetRecorderUI();
}

function setMicIcon(listening) {
  const icon =
    document.getElementById('micIcon');

  if (!icon) return;

  icon.className =
    listening
      ? 'fa fa-microphone'
      : 'fa fa-microphone-slash';
}

function setArticleMicIcon(listening) {
  const icon =
    document.getElementById('articleMicIcon');

  if (!icon) return;

  icon.className =
    listening
      ? 'fa fa-microphone'
      : 'fa fa-microphone-slash';
}

/* =========================================================
   SHARED UI AND TEXT HELPERS
========================================================= */

function restartTest() {
  closeRecognizer();
  closeArticleRecognizer();
  showView('menuView');
}

function setText(id, text) {
  const element =
    document.getElementById(id);

  if (element) {
    element.textContent =
      String(text ?? '');
  }
}

function setButton(
  button,
  disabled,
  text
) {
  if (!button) return;

  button.disabled = Boolean(disabled);
  button.textContent =
    String(text ?? '');
}

function showSaveWarning(title) {
  Swal.fire({
    toast: true,
    position: 'top-end',
    icon: 'warning',
    title,
    timer: 3500,
    showConfirmButton: false
  });
}

function showError(error) {
  const message =
    error?.message ||
    String(error || 'เกิดข้อผิดพลาด');

  Swal.fire({
    icon: 'error',
    title: 'เกิดข้อผิดพลาด',
    text: message
  });
}

/* =========================================================
   NORMALIZATION AND FORMATTING
========================================================= */

function cleanRecognized(text) {
  return String(text || '')
    .replace(/[.。!?！？,，]+$/g, '')
    .trim();
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeThaiWord(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(
      /[\s.,!?;:"'“”‘’()（）[\]{}<>]/g,
      ''
    )
    .trim();
}

function safeScore(value) {
  const number = Number(value);

  return Number.isFinite(number)
    ? Math.max(0, Math.min(100, number))
    : 0;
}

function round1(value) {
  return (
    Math.round(
      (Number(value) || 0) * 10
    ) / 10
  );
}

function round2(value) {
  return (
    Math.round(
      (Number(value) || 0) * 100
    ) / 100
  );
}

function formatPoint(value) {
  const number = round1(value);

  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(1);
}

function statusText(score) {
  if (score >= 90) {
    return 'อ่านถูกต้องดีมาก';
  }

  if (score >= 80) {
    return 'อ่านได้ดี';
  }

  if (score >= 70) {
    return 'ผ่านเกณฑ์';
  }

  if (score >= 50) {
    return 'ควรฝึกเพิ่มเติม';
  }

  return 'ควรอ่านใหม่';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

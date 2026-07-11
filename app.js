const API_URL =
  'https://script.google.com/macros/s/AKfycbyAvyBkU_vyyHwy5ekl3GIohGkA91WXL8sYIEmoaEEikGoWl7gr-OtUxfECO4fqia2Zfg/exec';

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

    Object.keys(data).forEach(key => {
      const value = data[key];

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
      script.remove();
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

    script.src =
      API_URL + '?' + params.toString();

    document.body.appendChild(script);
  });
}
const MAX_ATTEMPTS = 3;

let sessionToken = '';
let student = null;
let words = [];
let currentIndex = 0;
let currentAttempt = 1;
let completedScores = [];


const MAX_ACCUMULATED_SCORE = 40;
let recognizer = null;
let assessmentInProgress = false;

let wordSystemPoints = [];
let articleSystemPoints = [];
let articleWords = [];
let currentArticleIndex = 0;
let currentArticleAttempt = 1;
let articleRecognizer = null;
let articleAssessmentInProgress = false;

const MAX_ARTICLE_ATTEMPTS = 3;
const WORD_SYSTEM_FULL_SCORE = 40;
const ARTICLE_SYSTEM_FULL_SCORE = 60;
const GRAND_TOTAL_FULL_SCORE = 100;

document.getElementById('studentId').addEventListener('keydown', event => {
  if (event.key === 'Enter') login();
});

async function login() {
  const id = document.getElementById('studentId').value.trim();
  const button = document.getElementById('loginBtn');

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

    if (!result || !result.success) {
      throw new Error(
        result?.message || 'ไม่พบข้อมูลนักศึกษา'
      );
    }

    sessionToken = result.sessionToken;
    student = result;

    document.getElementById('studentName').textContent =
      result.name || result.studentId;

    document.getElementById('studentLevel').textContent =
      result.level || '';

   document.getElementById('menuStudentName').textContent =
  result.name || result.studentId;

showView('menuView');

  } catch (error) {
    setMicIcon(false);
    showError(error);

  } finally {
    setButton(button, false, 'เข้าสู่ระบบ');
  }
}
async function startArticleTest() {
  document.getElementById('articleStudentName').textContent =
    student?.name || student?.studentId || '—';

  document.getElementById('articleStudentLevel').textContent =
    student?.level || '';

  // นำคำเป้าหมายจาก span data-target ในบทความ
  articleWords = Array.from(
    document.querySelectorAll(
      '#articleContent span[data-target]'
    )
  ).map((element, index) => ({
    articleWordId:
      'A' + String(index + 1).padStart(3, '0'),

    word: String(
      element.dataset.target ||
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
        'พบคำเป้าหมาย ' +
        articleWords.length +
        ' คำ ต้องมีทั้งหมด 20 คำ'
    });

    return;
  }

  currentArticleIndex = 0;
  currentArticleAttempt = 1;
  articleSystemPoints = [];

  showView('articleView');
  renderArticleWord();
}
async function startWordTest() {
  await loadWords();
}
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
    completedScores = [];

    // รีเซ็ตคะแนนระบบอ่านคำ 20 คำ
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
function calculateArticlePoint(score) {
  score = Math.max(0, Math.min(100, Number(score) || 0));

  return Math.round((score / 100) * 3 * 10) / 10;
}
function sumPoints(points) {
  return points.reduce(
    (total, point) => total + (Number(point) || 0),
    0
  );
}

function getGrandTotalPoint() {
  return (
    sumPoints(wordSystemPoints) +
    sumPoints(articleSystemPoints)
  );
}
function renderWord() {
  const item = words[currentIndex];
  const percent = ((currentIndex + 1) / words.length) * 100;

  document.getElementById('counter').textContent =
    `คำที่ ${currentIndex + 1} จาก ${words.length}`;
  document.getElementById('progressBar').style.width = percent + '%';
  document.getElementById('wordText').textContent = item.word;
  document.getElementById('wordMeta').textContent =
    [item.level, item.category].filter(Boolean).join(' • ');

  document.getElementById('resultBox').classList.add('hidden');
  document.getElementById('micCircle').classList.remove('listening');
  document.getElementById('statusText').textContent =
    'เมื่อพร้อม ให้กดปุ่มแล้วอ่านคำที่แสดง';

  setButton(
    document.getElementById('recordBtn'),
    false,
    'กดเพื่อเริ่มอ่าน'
  );
}
async function startArticleAssessment() {
  if (articleAssessmentInProgress) return;

  if (typeof SpeechSDK === 'undefined') {
    Swal.fire({
      icon: 'error',
      title: 'โหลด Azure Speech SDK ไม่สำเร็จ',
      text: 'กรุณารีเฟรชหน้าเว็บแล้วลองใหม่'
    });

    return;
  }

  const item = articleWords[currentArticleIndex];

  if (!item) {
    Swal.fire({
      icon: 'warning',
      title: 'ไม่พบคำที่ต้องอ่าน'
    });

    return;
  }

  try {
    document.getElementById('articleStatusText').textContent =
      'กำลังขออนุญาตใช้ไมโครโฟน...';

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

  } catch (error) {
    Swal.fire({
      icon: 'warning',
      title: 'ไม่สามารถใช้ไมโครโฟนได้',
      text:
        error?.message ||
        'กรุณาอนุญาตให้เว็บไซต์ใช้ไมโครโฟน'
    });

    resetArticleRecorderUI();
    return;
  }

  articleAssessmentInProgress = true;

  document
    .getElementById('articleMicCircle')
    .classList.add('listening');

  setArticleMicIcon(true);

  document.getElementById('articleStatusText').textContent =
    'กำลังเชื่อมต่อระบบวิเคราะห์เสียง...';

  try {
    const auth = await callApi('getAzureToken', {
      sessionToken
    });

    beginArticleAzure(auth);

  } catch (error) {
    articleAssessmentInProgress = false;
    resetArticleRecorderUI();
    showError(error);
  }
}
function renderArticleWord() {
  const item = articleWords[currentArticleIndex];

  if (!item) {
    showArticleSummary();
    return;
  }

  const percent =
    ((currentArticleIndex + 1) / articleWords.length) * 100;

  document.getElementById('articleCounter').textContent =
    `คำที่ ${currentArticleIndex + 1} จาก ${articleWords.length}`;

  document.getElementById(
    'articleProgressBar'
  ).style.width = percent + '%';

  document.getElementById('articleTargetWord').textContent =
    item.word;

  document
    .querySelectorAll('#articleContent span[data-target]')
    .forEach(element => {
      element.classList.remove('current-target');
    });

  item.element.classList.add('current-target');

  item.element.scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  });

  document.getElementById('articleStatusText').textContent =
    'กดไมโครโฟนแล้วอ่านคำที่เน้น';

  resetArticleRecorderUI();
}
async function startAssessment() {
  if (assessmentInProgress) return;

  if (typeof SpeechSDK === 'undefined') {
    Swal.fire({
      icon: 'error',
      title: 'โหลด Azure Speech SDK ไม่สำเร็จ',
      text: 'กรุณารีเฟรชหน้าเว็บแล้วลองใหม่'
    });
    return;
  }

  if (
    !navigator.mediaDevices ||
    typeof navigator.mediaDevices.getUserMedia !== 'function'
  ) {
    Swal.fire({
      icon: 'error',
      title: 'เบราว์เซอร์ไม่รองรับไมโครโฟน',
      text: 'กรุณาเปิดระบบด้วย Google Chrome หรือ Microsoft Edge เวอร์ชันล่าสุด'
    });
    return;
  }

  try {
    document.getElementById('statusText').textContent =
      'กำลังขออนุญาตใช้ไมโครโฟน...';

    /*
     * ขอสิทธิ์จากการกดปุ่มของผู้ใช้โดยตรง
     * ต้องทำก่อนเรียก Azure SDK
     */
    const testStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });

    /*
     * ปิด stream ทดสอบทันที
     * Azure SDK จะเปิดไมโครโฟนอีกครั้งเอง
     */
    testStream.getTracks().forEach(track => track.stop());

  } catch (error) {
    console.error('Microphone permission error:', error);

    let title = 'ไม่สามารถใช้ไมโครโฟนได้';
    let message =
      'กรุณาตรวจสอบไมโครโฟน แล้วลองเปิดหน้าเว็บในแท็บใหม่อีกครั้ง';

    if (
      error.name === 'NotAllowedError' ||
      error.name === 'PermissionDeniedError'
    ) {
      message =
        'Chrome ไม่อนุญาตให้หน้าเว็บนี้ใช้ไมโครโฟน กรุณาคลิกไอคอนด้านซ้ายของ URL แล้วตั้งค่าไมโครโฟนเป็น “อนุญาต” จากนั้นรีเฟรชหน้า GitHub Pages ใหม่';
    } else if (
      error.name === 'NotFoundError' ||
      error.name === 'DevicesNotFoundError'
    ) {
      message =
        'ไม่พบอุปกรณ์ไมโครโฟน กรุณาเชื่อมต่อไมโครโฟนหรือตรวจสอบอุปกรณ์เสียงของ Windows';
    } else if (
      error.name === 'NotReadableError' ||
      error.name === 'TrackStartError'
    ) {
      message =
        'ไม่สามารถเปิดไมโครโฟนได้ อาจมีโปรแกรมอื่นกำลังใช้งานอยู่ กรุณาปิด Google Meet, Zoom หรือโปรแกรมบันทึกเสียง แล้วลองใหม่';
    } else if (error.name === 'SecurityError') {
      message =
        'เบราว์เซอร์บล็อกไมโครโฟนเนื่องจากข้อกำหนดด้านความปลอดภัย กรุณาเปิดหน้า GitHub Pages โดยตรง และไม่เปิดผ่าน iframe';
    }

    Swal.fire({
      icon: 'warning',
      title: title,
      text: message,
      confirmButtonText: 'ตกลง'
    });

    document.getElementById('statusText').textContent =
      'ยังไม่ได้รับอนุญาตให้ใช้ไมโครโฟน';

    return;
  }

  assessmentInProgress = true;

  document
    .getElementById('resultBox')
    .classList.add('hidden');

  setButton(
    document.getElementById('recordBtn'),
    true,
    'กำลังเตรียม...'
  );

  document.getElementById('statusText').textContent =
    'กำลังเชื่อมต่อระบบวิเคราะห์เสียง...';

try {
  const auth = await callApi('getAzureToken', {
    sessionToken
  });

  beginAzure(auth);

} catch (error) {
  assessmentInProgress = false;
  resetRecorderUI();
  setMicIcon(false);
  showError(error);
}
}

function beginArticleAzure(auth) {
  try {
    const item = articleWords[currentArticleIndex];

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

    articleRecognizer =
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

    pronunciationConfig.applyTo(articleRecognizer);

    document
      .getElementById('articleMicCircle')
      .classList.add('listening');

    setArticleMicIcon(true);

    document.getElementById('articleStatusText').textContent =
      `กรุณาอ่านคำว่า “${item.word}”`;

    articleRecognizer.recognizeOnceAsync(
      result => {
        closeArticleRecognizer();

        articleAssessmentInProgress = false;

        handleArticleRecognition(result);
      },

      error => {
        closeArticleRecognizer();

        articleAssessmentInProgress = false;

        resetArticleRecorderUI();

        Swal.fire({
          icon: 'error',
          title: 'วิเคราะห์เสียงไม่สำเร็จ',
          text: String(
            error || 'เกิดข้อผิดพลาด'
          )
        });
      }
    );

  } catch (error) {
    closeArticleRecognizer();

    articleAssessmentInProgress = false;

    resetArticleRecorderUI();

    showError(error);
  }
}
function handleArticleRecognition(result) {
  resetArticleRecorderUI();

  if (
    result.reason ===
    SpeechSDK.ResultReason.RecognizedSpeech
  ) {
    const pronunciationResult =
      SpeechSDK.PronunciationAssessmentResult
        .fromResult(result);

    const data = {
      recognizedText:
        cleanRecognized(result.text),

      accuracy:
        safeScore(
          pronunciationResult.accuracyScore
        ),

      fluency:
        safeScore(
          pronunciationResult.fluencyScore
        ),

      completeness:
        safeScore(
          pronunciationResult.completenessScore
        ),

      pronunciation:
        safeScore(
          pronunciationResult.pronunciationScore
        )
    };

    data.finalScore = round2(
      data.accuracy * 0.85 +
      data.pronunciation * 0.15
    );

    // ข้อละเต็ม 3 คะแนน
    data.point =
      calculateArticlePoint(data.finalScore);

    // อ่านซ้ำให้แทนคะแนนเดิม ไม่บวกซ้ำ
    articleSystemPoints[currentArticleIndex] =
      data.point;

    data.articleAccumulatedPoint =
      sumPoints(articleSystemPoints);

    data.wordSystemPoint =
      sumPoints(wordSystemPoints);

    data.grandTotalPoint =
      getGrandTotalPoint();

    showArticleResult(data);
    saveArticleResult(data);

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
        'กรุณาลองใหม่อีกครั้ง'
    });

    return;
  }

  Swal.fire({
    icon: 'warning',
    title: 'ไม่สามารถอ่านผลเสียงได้',
    text: 'กรุณาลองใหม่อีกครั้ง'
  });
}
async function testMicrophoneOnly() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true
    });

    stream.getTracks().forEach(track => track.stop());

    Swal.fire({
      icon: 'success',
      title: 'ไมโครโฟนพร้อมใช้งาน',
      text: 'เบราว์เซอร์อนุญาตให้ระบบใช้ไมโครโฟนแล้ว'
    });

  } catch (error) {
    Swal.fire({
      icon: 'error',
      title: 'ไมโครโฟนยังใช้งานไม่ได้',
      text: error.name + ': ' + error.message
    });
  }
}
function showArticleResult(data) {
  const item =
    articleWords[currentArticleIndex];

  Swal.fire({
    title: 'ผลการอ่านบทความ',
    width: 620,
    allowOutsideClick: false,

    showCancelButton:
      currentArticleAttempt <
      MAX_ARTICLE_ATTEMPTS,

    cancelButtonText: 'อ่านอีกครั้ง',

    confirmButtonText:
      currentArticleIndex ===
      articleWords.length - 1
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
              เต็ม 3 คะแนน
            </small>
          </div>

          <div class="popup-point-item">
            <span class="popup-point-title">
              คะแนนสะสมบทความ
            </span>

            <b class="popup-point-number">
              ${formatPoint(
                data.articleAccumulatedPoint
              )}
            </b>

            <small class="popup-point-full">
              เต็ม 60 คะแนน
            </small>
          </div>

        </div>

        <div class="popup-grand-total">
          คะแนนรวมทั้ง 2 ระบบ

          <strong>
            ${formatPoint(data.grandTotalPoint)}
            / 100 คะแนน
          </strong>
        </div>

        <div class="popup-word">
          คำที่ประเมิน:
          <strong>
            ${escapeHtml(item.word)}
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
            <b>${Math.round(
              data.pronunciation
            )}</b>
            <span>การออกเสียง</span>
          </div>

          <div>
            <b>${Math.round(data.fluency)}</b>
            <span>ความคล่อง</span>
          </div>

          <div>
            <b>${Math.round(
              data.completeness
            )}</b>
            <span>ความครบถ้วน</span>
          </div>
        </div>

      </div>
    `
  }).then(result => {
    if (result.isConfirmed) {
      nextArticleWord();
      return;
    }

    if (
      result.dismiss ===
      Swal.DismissReason.cancel
    ) {
      retryArticleWord();
    }
  });
}
function beginAzure(auth) {
  try {
    const item = words[currentIndex];
    if (!auth?.token || !auth?.region) {
      throw new Error('ข้อมูล Azure Token ไม่สมบูรณ์');
    }

    const speechConfig =
      SpeechSDK.SpeechConfig.fromAuthorizationToken(auth.token, auth.region);

    speechConfig.speechRecognitionLanguage = 'th-TH';
    speechConfig.outputFormat = SpeechSDK.OutputFormat.Detailed;
    speechConfig.setProperty(
      SpeechSDK.PropertyId.SpeechServiceConnection_InitialSilenceTimeoutMs,
      '5000'
    );
    speechConfig.setProperty(
      SpeechSDK.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
      '1200'
    );

    const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
    recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

    const config = new SpeechSDK.PronunciationAssessmentConfig(
      item.word,
      SpeechSDK.PronunciationAssessmentGradingSystem.HundredMark,
      SpeechSDK.PronunciationAssessmentGranularity.Word,
      true
    );
    config.applyTo(recognizer);

  document.getElementById('micCircle').classList.add('listening');
setMicIcon(true);
    setButton(document.getElementById('recordBtn'), true, 'กำลังฟังเสียง...');
    document.getElementById('statusText').textContent =
      `กรุณาอ่านคำว่า “${item.word}”`;

    recognizer.recognizeOnceAsync(
      result => {
        closeRecognizer();
        assessmentInProgress = false;
        handleRecognition(result);
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
    setMicIcon(false);
    showError(error);
  }
}
function retryArticleWord() {
  if (currentArticleAttempt >= MAX_ARTICLE_ATTEMPTS) {
    Swal.fire({
      icon: 'info',
      title: 'อ่านครบจำนวนครั้งแล้ว',
      text: `คำนี้อ่านได้สูงสุด ${MAX_ARTICLE_ATTEMPTS} ครั้ง`
    });
    return;
  }

  currentArticleAttempt++;

  resetArticleRecorderUI();

  document.getElementById('articleStatusText').textContent =
    `ครั้งที่ ${currentArticleAttempt} จาก ${MAX_ARTICLE_ATTEMPTS} — กดไมโครโฟนเพื่ออ่านอีกครั้ง`;
}

function nextArticleWord() {
  if (
    currentArticleIndex ===
    articleWords.length - 1
  ) {
    showArticleSummary();
    return;
  }

  currentArticleIndex++;
  currentArticleAttempt = 1;

  renderArticleWord();
}
function handleRecognition(result) {
  resetRecorderUI();

  if (result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
    const p =
      SpeechSDK.PronunciationAssessmentResult.fromResult(result);

    const data = {
      recognizedText: cleanRecognized(result.text),
      accuracy: safeScore(p.accuracyScore),
      fluency: safeScore(p.fluencyScore),
      completeness: safeScore(p.completenessScore),
      pronunciation: safeScore(p.pronunciationScore)
    };

data.finalScore = round2(
  data.accuracy * 0.85 +
  data.pronunciation * 0.15
);

data.point = calculatePoint(data.finalScore);

wordSystemPoints[currentIndex] = data.point;

data.accumulatedPoint = getAccumulatedPoint();

data.isLikelyCorrectWord = data.accuracy >= 60;

showResult(data);
saveResult(data);
    return;
  }

  if (result.reason === SpeechSDK.ResultReason.NoMatch) {
    Swal.fire({
      icon: 'warning',
      title: 'ไม่ได้ยินเสียงชัดเจน',
      text: 'กรุณาเข้าใกล้ไมโครโฟนและอ่านอีกครั้ง'
    });
    return;
  }

  if (result.reason === SpeechSDK.ResultReason.Canceled) {
    const detail =
      SpeechSDK.CancellationDetails.fromResult(result);

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
function closeArticleRecognizer() {
  if (articleRecognizer) {
    try {
      articleRecognizer.close();
    } catch (error) {
      console.error(error);
    }

    articleRecognizer = null;
  }

  resetArticleRecorderUI();
}
function resetArticleRecorderUI() {

  document
    .getElementById("articleMicCircle")
    .classList.remove("listening");

  setArticleMicIcon(false);

  document.getElementById(
    "articleStatusText"
  ).textContent =
      "กดไมโครโฟนแล้วอ่านคำที่เน้น";
}
function setArticleMicIcon(listening) {
  const icon =
    document.getElementById("articleMicIcon");

  if (!icon) return;

  icon.className = listening
      ? "fa fa-microphone"
      : "fa fa-microphone-slash";
}
function showArticleSummary() {
  closeArticleRecognizer();
  showView('summaryView');

  const articlePoint =
    sumPoints(articleSystemPoints);

  const wordPoint =
    sumPoints(wordSystemPoints);

  const grandTotal =
    wordPoint + articlePoint;

  document.getElementById(
    'averageScore'
  ).innerHTML = `
    <div>
      อ่านคำ:
      ${formatPoint(wordPoint)} / 40
    </div>

    <div>
      อ่านบทความ:
      ${formatPoint(articlePoint)} / 60
    </div>

    <div style="margin-top:12px;">
      รวม:
      ${formatPoint(grandTotal)} / 100 คะแนน
    </div>
  `;
}
async function saveArticleResult(data) {
  const item =
    articleWords[currentArticleIndex];

  const payload = {
    articleWordId: item.articleWordId,
    referenceWord: item.word,
    recognizedText: data.recognizedText,

    accuracy: data.accuracy,
    fluency: data.fluency,
    completeness: data.completeness,
    pronunciation: data.pronunciation,

    finalScore: data.finalScore,
    point: data.point,

    accumulatedPoint:
      data.articleAccumulatedPoint,

    fullPoint:
      ARTICLE_SYSTEM_FULL_SCORE,

    grandTotalPoint:
      data.grandTotalPoint,

    grandTotalFullPoint:
      GRAND_TOTAL_FULL_SCORE,

    attempt:
      currentArticleAttempt
  };

  try {
    await callApi('saveArticleResult', {
      sessionToken,
      payload
    });

  } catch (error) {
    console.error(
      'บันทึกผลบทความไม่สำเร็จ',
      error
    );

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'warning',
      title:
        'แสดงผลได้ แต่บันทึกผลบทความไม่สำเร็จ',
      timer: 3500,
      showConfirmButton: false
    });
  }
}
function showResult(data) {
  const currentWord = words[currentIndex]?.word || '—';

  Swal.fire({
    title: 'ผลการอ่านออกเสียง',
    width: 620,
    allowOutsideClick: false,

    showCancelButton: currentAttempt < MAX_ATTEMPTS,
    cancelButtonText: 'อ่านอีกครั้ง',

    confirmButtonText:
      currentIndex === words.length - 1
        ? 'ดูผลสรุป'
        : 'คำถัดไป',

    html: `
      <div class="popup-result">

        <!-- คะแนนข้อนี้และคะแนนสะสม -->
        <div class="popup-point-summary">

          <div class="popup-point-item">
            <span class="popup-point-title">คะแนน</span>

            <b class="popup-point-number">
              ${formatPoint(data.point)}
            </b>

            <small class="popup-point-full">
              เต็ม 2 คะแนน
            </small>
          </div>

          <div class="popup-point-item">
            <span class="popup-point-title">คะแนนสะสม</span>

            <b class="popup-point-number">
              ${formatPoint(data.accumulatedPoint)}
            </b>

            <small class="popup-point-full">
              เต็ม ${MAX_ACCUMULATED_SCORE} คะแนน
            </small>
          </div>

        </div>

        <!-- คำที่ประเมิน -->
        <div class="popup-word">
          คำที่ประเมิน:
          <strong>${escapeHtml(currentWord)}</strong>
        </div>

        <!-- ย้ายเปอร์เซ็นต์มาไว้ใต้คำที่ประเมิน -->
        <div class="popup-score">
          ${Math.round(data.finalScore)}%
        </div>

        <div class="popup-status">
          ${statusText(data.finalScore)}
        </div>

        <!-- รายละเอียดคะแนน -->
        <div class="popup-score-grid">
          <div>
            <b>${Math.round(data.accuracy)}</b>
            <span>ความถูกต้อง</span>
          </div>

          <div>
            <b>${Math.round(data.pronunciation)}</b>
            <span>การออกเสียง</span>
          </div>

          <div>
            <b>${Math.round(data.fluency)}</b>
            <span>ความคล่อง</span>
          </div>

          <div>
            <b>${Math.round(data.completeness)}</b>
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

    if (result.dismiss === Swal.DismissReason.cancel) {
      retryCurrentWord();
    }
  });
}
async function saveResult(data) {
  const item = words[currentIndex];
  const savedIndex = currentIndex;

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
    fullPoint: MAX_ACCUMULATED_SCORE,
    attempt: currentAttempt
  };

  try {
    const result = await callApi('saveResult', {
      sessionToken,
      payload
    });

    if (result?.success) {
      completedScores[savedIndex] =
        Number(result.finalScore) || 0;
    }
  } catch (error) {
    console.error('บันทึกผลไม่สำเร็จ', error);

    Swal.fire({
      toast: true,
      position: 'top-end',
      icon: 'warning',
      title: 'แสดงผลได้ แต่บันทึกลงชีตไม่สำเร็จ',
      timer: 3500,
      showConfirmButton: false
    });
  }
}
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
function retryCurrentWord() {
  if (currentAttempt >= MAX_ATTEMPTS) {
    Swal.fire({
      icon: 'info',
      title: 'อ่านครบจำนวนครั้งแล้ว',
      text: `คำนี้อ่านได้สูงสุด ${MAX_ATTEMPTS} ครั้ง`
    });
    return;
  }
  currentAttempt++;
  document.getElementById('resultBox').classList.add('hidden');
  document.getElementById('statusText').textContent =
    `ครั้งที่ ${currentAttempt} จาก ${MAX_ATTEMPTS}`;
  setButton(document.getElementById('recordBtn'), false, 'กดเพื่ออ่านอีกครั้ง');
}

function nextWord() {
  if (currentIndex === words.length - 1) {
    showSummary();
    return;
  }
  currentIndex++;
  currentAttempt = 1;
  renderWord();
}

function showSummary() {
  closeRecognizer();
  showView('summaryView');

  const totalPoint = getAccumulatedPoint();

  document.getElementById('averageScore').textContent =
    formatPoint(totalPoint) + ' / 40 คะแนน';
}

function restartTest(){

    showView("menuView");

}

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
    const showMicTest =
      id === 'testView' ||
      id === 'articleView';

    micTestArea.classList.toggle(
      'hidden',
      !showMicTest
    );
  }
}

function resetRecorderUI() {
  document.getElementById('micCircle').classList.remove('listening');
  setMicIcon(false);

  setButton(
    document.getElementById('recordBtn'),
    false,
    'กดเพื่อเริ่มอ่าน'
  );

  document.getElementById('statusText').textContent =
    'เมื่อพร้อม ให้กดปุ่มแล้วอ่านคำที่แสดง';
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

  const circle = document.getElementById('micCircle');

  if (circle) {
    circle.classList.remove('listening');
  }

  setMicIcon(false);
}
function setMicIcon(listening) {
  const icon = document.getElementById("micIcon");
  if (!icon) return;

  if (listening) {
    icon.className = "fa fa-microphone";
  } else {
    icon.className = "fa fa-microphone-slash";
  }
}
function setButton(button, disabled, text) {
  button.disabled = disabled;
  button.textContent = text;
}

function cleanRecognized(text) {
  return String(text || '').replace(/[.。!?！？,，]+$/g, '').trim();
}

function safeScore(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}
function calculatePoint(score) {
  score = Number(score) || 0;

  if (score >= 70) {
    return 2;
  }

  if (score >= 41) {
    // 41% = 1.1 และ 69% = 1.9
    const point =
      1.1 + ((score - 41) * 0.8 / 28);

    return Math.round(point * 10) / 10;
  }

  if (score >= 40) {
    return 1;
  }

if (score >= 11) {

  const point =
      0.1 + ((score - 11) * 0.8 / 28);

  return Math.round(point * 10) / 10;
}

  return 0;
}

function getAccumulatedPoint() {
  return wordSystemPoints.reduce(
    (total, point) =>
      total + (Number(point) || 0),
    0
  );
}

function formatPoint(value) {
  const number = Number(value) || 0;

  return Number.isInteger(number)
    ? String(number)
    : number.toFixed(1);
}
function statusText(score) {
  if (score >= 90) return 'อ่านถูกต้องดีมาก';
  if (score >= 80) return 'อ่านได้ดี';
  if (score >= 70) return 'ผ่านเกณฑ์';
  if (score >= 50) return 'ควรฝึกเพิ่มเติม';
  return 'ควรอ่านใหม่';
}

function showError(error) {
  const message = error?.message || String(error || 'เกิดข้อผิดพลาด');
  Swal.fire({ icon: 'error', title: 'เกิดข้อผิดพลาด', text: message });
}

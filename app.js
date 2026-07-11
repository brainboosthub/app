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
let recognizer = null;
let assessmentInProgress = false;

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

    await loadWords();

  } catch (error) {
    showError(error);

  } finally {
    setButton(button, false, 'เข้าสู่ระบบ');
  }
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

    Swal.close();
    showView('testView');
    renderWord();

  } catch (error) {
    Swal.close();
    showError(error);
  }
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
  showError(error);
}
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
    showError(error);
  }
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

    data.isLikelyCorrectWord =
      data.accuracy >= 60;

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

function showResult(data) {
document.getElementById('recognizedText').textContent =
  words[currentIndex]?.word || 'ไม่พบคำ';
  document.getElementById('accuracyScore').textContent =
    Math.round(data.accuracy);
  document.getElementById('fluencyScore').textContent =
    Math.round(data.fluency);
  document.getElementById('completenessScore').textContent =
    Math.round(data.completeness);
  document.getElementById('pronunciationScore').textContent =
    Math.round(data.pronunciation);
  document.getElementById('finalScore').textContent =
    Math.round(data.finalScore) + '%';
  document.getElementById('finalStatus').textContent =
    statusText(data.finalScore);

  document.getElementById('retryBtn').disabled =
    currentAttempt >= MAX_ATTEMPTS;
  document.getElementById('nextBtn').textContent =
    currentIndex === words.length - 1 ? 'ดูผลสรุป' : 'คำถัดไป';
  document.getElementById('resultBox').classList.remove('hidden');
  document.getElementById('statusText').textContent =
    'วิเคราะห์เสียงเรียบร้อยแล้ว';
    const heardBox = document.getElementById('recognizedText');

if (data.accuracy >= 60) {
  heardBox.textContent = words[currentIndex]?.word || '—';
} else {
  heardBox.textContent = 'เสียงไม่ตรงกับคำที่กำหนด';
}
}

async function saveResult(data) {
  const item = words[currentIndex];

  const payload = {
    wordId: item.wordId,
    referenceWord: item.word,
    recognizedText: data.recognizedText,
    accuracy: data.accuracy,
    fluency: data.fluency,
    completeness: data.completeness,
    pronunciation: data.pronunciation,
    attempt: currentAttempt
  };

  try {
    const result = await callApi('saveResult', {
      sessionToken,
      payload
    });

    if (result?.success) {
      completedScores[currentIndex] =
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

  const scores = completedScores.filter(Number.isFinite);
  const average = scores.length
    ? scores.reduce((sum, n) => sum + n, 0) / scores.length
    : 0;

  document.getElementById('averageScore').textContent =
    Math.round(average) + '%';
}

function restartTest() {
  loadWords();
}

function showView(id) {
  ['loginView', 'testView', 'summaryView'].forEach(viewId => {
    document
      .getElementById(viewId)
      .classList.toggle('hidden', viewId !== id);
  });

  const micTestArea =
    document.getElementById('micTestArea');

  if (micTestArea) {
    micTestArea.classList.toggle(
      'hidden',
      id !== 'testView'
    );
  }
}

function resetRecorderUI() {
  document.getElementById('micCircle').classList.remove('listening');
setMicIcon(false);
  setButton(document.getElementById('recordBtn'), false, 'กดเพื่อเริ่มอ่าน');
}

function closeRecognizer() {
  if (!recognizer) return;
  try { recognizer.close(); } catch (e) { console.error(e); }
  recognizer = null;
  setMicIcon(false);
}
function setMicIcon(listening = false) {
  const icon = document.getElementById('micIcon');
  if (!icon) return;

  if (listening) {
    icon.className = 'fa fa-microphone';
  } else {
    icon.className = 'fa fa-microphone-slash';
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

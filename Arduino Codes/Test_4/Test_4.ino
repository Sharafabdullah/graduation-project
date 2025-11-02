// === Pins (same as your code) ===
#define xdirPin 3
#define xstepPin 2
#define ydirPin 4
#define ystepPin 5
// (Optional) #define enablePin 8  // فعّل إذا عندك ENABLE بالدرايفر

// Pulse timing (speed): أعلى = أسرع دوران. قلّلها لتبطئ.
const unsigned int PULSE_US = 500;  // 500µs HIGH + 500µs LOW = ~1 kHz stepping

// -------- Helpers --------

// نبضة واحدة متزامنة للمحورين
inline void pulseBoth() {
  digitalWrite(xstepPin, HIGH);
  digitalWrite(ystepPin, HIGH);
  delayMicroseconds(PULSE_US);
  digitalWrite(xstepPin, LOW);
  digitalWrite(ystepPin, LOW);
  delayMicroseconds(PULSE_US);
}

// حركة متزامنة لكلا المحورين بنفس عدد الخطوات وبنفس/عكس الاتجاه حسب الدخل
void moveBothSame(long steps, bool xDirHigh, bool yDirHigh) {
  digitalWrite(xdirPin, xDirHigh ? HIGH : LOW);
  digitalWrite(ydirPin, yDirHigh ? HIGH : LOW);
  for (long i = 0; i < steps; i++) {
    pulseBoth(); // نبضة متزامنة للمحورين
  }
}

// (اختياري) مزامنة عند اختلاف عدد الخطوات بين X و Y
// تتحكم بحيث يوصلا بنفس الوقت حتى لو xSteps != ySteps
void moveBothSync(long xSteps, long ySteps, bool xDirHigh, bool yDirHigh) {
  if (xSteps < 0) { xSteps = -xSteps; xDirHigh = !xDirHigh; }
  if (ySteps < 0) { ySteps = -ySteps; yDirHigh = !yDirHigh; }

  digitalWrite(xdirPin, xDirHigh ? HIGH : LOW);
  digitalWrite(ydirPin, yDirHigh ? HIGH : LOW);

  long maxSteps = (xSteps > ySteps) ? xSteps : ySteps;
  long xCount = 0, yCount = 0;
  long xErr = 0,   yErr = 0;

  for (long i = 0; i < maxSteps; i++) {
    // نقرر إذا نعطي نبضة لكل محور بناءً على النسبة
    bool stepX = (xCount < xSteps);
    bool stepY = (yCount < ySteps);

    // ارفع فقط الأرجل المطلوبة بنفس اللحظة
    if (stepX) digitalWrite(xstepPin, HIGH);
    if (stepY) digitalWrite(ystepPin, HIGH);
    delayMicroseconds(PULSE_US);
    if (stepX) digitalWrite(xstepPin, LOW);
    if (stepY) digitalWrite(ystepPin, LOW);
    delayMicroseconds(PULSE_US);

    // حدّث العدادات (تقريب خطّي مثل Bresenham)
    if (stepX) xCount++;
    if (stepY) yCount++;
  }
}

void setup() {
  pinMode(xdirPin, OUTPUT);
  pinMode(xstepPin, OUTPUT);
  pinMode(ydirPin, OUTPUT);
  pinMode(ystepPin, OUTPUT);
  // (اختياري)
  // pinMode(enablePin, OUTPUT);
  // digitalWrite(enablePin, LOW); // LOW لتمكين بعض الدرايفرات (تحسبًا)
}

void loop() {
  // ---- تحريك المحورين بنفس الوقت وبنفس عدد الخطوات ----
  // مع اتجاه عقارب الساعة (HIGH) لكلا المحورين
  moveBothSame(2325, xDirHigh=true, yDirHigh=true);

  // (اختياري) مهلة قصيرة للراحة
  // delay(300);

  // عكس الاتجاه لكلا المحورين
  moveBothSame(2325, xDirHigh=false, yDirHigh=false);

  // delay(300);

  // ---- مثال (اختياري): تحريك بخطوات مختلفة لكن متزامن بالوصول ----
  // moveBothSync(3000, 1500, true, true);  // X يمشي 3000 و Y يمشي 1500 ويخلصوا سوا
  // moveBothSync(3000, 1500, false, false);
}
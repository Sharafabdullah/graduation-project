#define xdirPin 3
#define xstepPin 2
#define ydirPin 4
#define ystepPin 5

void setup() {
  pinMode(xdirPin, OUTPUT);
  pinMode(xstepPin, OUTPUT);
  pinMode(ydirPin, OUTPUT);
  pinMode(ystepPin, OUTPUT);
}

void loop() {
  // اتجاه عقارب الساعة
  digitalWrite(xdirPin, HIGH);
  digitalWrite(ydirPin, HIGH);
  for (int i = 0; i < 1600; i++) { // عدد الخطوات (200 = دورة كاملة لمحرك 1.8°)
    digitalWrite(xstepPin, HIGH);
    digitalWrite(ystepPin, HIGH);
    delayMicroseconds(500);
    digitalWrite(xstepPin, LOW);
    digitalWrite(ystepPin, LOW);
    delayMicroseconds(500);
  }
  delay(500);

  // عكس الاتجاه
  digitalWrite(xdirPin, LOW);
  digitalWrite(ydirPin, LOW);
  for (int i = 0; i < 1600; i++) {
    digitalWrite(xstepPin, HIGH);
    digitalWrite(ystepPin, HIGH);
    delayMicroseconds(500);
    digitalWrite(xstepPin, LOW);
    digitalWrite(ystepPin, LOW);
    delayMicroseconds(500);
  }
  delay(500);
}

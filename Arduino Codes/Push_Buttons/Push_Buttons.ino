#define xdirPin 7
#define xstepPin 6
#define ydirPin 8
#define ystepPin 12

#define yrev 2
#define yfor 3
#define xrev 4
#define xfor 5

int xfors = 0;
int xrevs = 0;
int yfors = 0;
int yrevs = 0;

void setup() {
  pinMode(xdirPin, OUTPUT);
  pinMode(xstepPin, OUTPUT);
  pinMode(ydirPin, OUTPUT);
  pinMode(ystepPin, OUTPUT);

  // استخدم Pull-up داخلي للأزرار
  pinMode(xrev, INPUT_PULLUP);
  pinMode(xfor, INPUT_PULLUP);
  pinMode(yrev, INPUT_PULLUP);
  pinMode(yfor, INPUT_PULLUP);
}

void loop() {
  xfors = digitalRead(xfor);
  xrevs = digitalRead(xrev);
  yfors = digitalRead(yfor);
  yrevs = digitalRead(yrev);

  // LOW معناها الزر مضغوط لأننا نستخدم INPUT_PULLUP
  if (xfors == LOW) {
    digitalWrite(xdirPin, HIGH); // X forward
    while (digitalRead(xfor) == LOW) {
      digitalWrite(xstepPin, HIGH);
      delayMicroseconds(500);
      digitalWrite(xstepPin, LOW);
      delayMicroseconds(500);
    }
  }

  if (xrevs == LOW) {
    digitalWrite(xdirPin, LOW); // X reverse
    while (digitalRead(xrev) == LOW) {
      digitalWrite(xstepPin, HIGH);
      delayMicroseconds(500);
      digitalWrite(xstepPin, LOW);
      delayMicroseconds(500);
    }
  }

  if (yfors == LOW) {
    digitalWrite(ydirPin, HIGH); // Y forward
    while (digitalRead(yfor) == LOW) {
      digitalWrite(ystepPin, HIGH);
      delayMicroseconds(500);
      digitalWrite(ystepPin, LOW);
      delayMicroseconds(500);
    }
  }

  if (yrevs == LOW) {
    digitalWrite(ydirPin, LOW); // Y reverse
    while (digitalRead(yrev) == LOW) {
      digitalWrite(ystepPin, HIGH);
      delayMicroseconds(500);
      digitalWrite(ystepPin, LOW);
      delayMicroseconds(500);
    }
  }
}


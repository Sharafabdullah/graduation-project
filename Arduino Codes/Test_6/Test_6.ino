#define dirPin 4
#define stepPin 5

void setup() {
  pinMode(dirPin, OUTPUT);
  pinMode(stepPin, OUTPUT);
}

void loop() {
  // اتجاه عقارب الساعة
  digitalWrite(dirPin, HIGH);
  for (int i = 0; i < 600; i++) { // عدد الخطوات (200 = دورة كاملة لمحرك 1.8°)
    digitalWrite(stepPin, HIGH);
    delayMicroseconds(500);
    digitalWrite(stepPin, LOW);
    delayMicroseconds(500);
  }
  //delay(1000);

  // عكس الاتجاه
  digitalWrite(dirPin, LOW);
  for (int i = 0; i < 600; i++) {
    digitalWrite(stepPin, HIGH);
    delayMicroseconds(500);
    digitalWrite(stepPin, LOW);
    delayMicroseconds(500);
  }
  //delay(1000);
}

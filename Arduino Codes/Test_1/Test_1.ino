#define xdirpin 2
#define xsteppin 3
#define ydirpin 4
#define ysteppin 5

void setup() {
  pinMode(xdirpin, OUTPUT);
  pinMode(xsteppin, OUTPUT);
  pinMode(ydirpin, OUTPUT);
  pinMode(ysteppin, OUTPUT);
}

void loop() {
  int steptime = 800;
  forward1(steptime);
  delay(500);
  backward1(steptime);
  delay(500);
  forward2(steptime);
  delay(500);
  backward2(steptime);
  delay(500);
}

void forward1(int steptime){
  digitalWrite(xdirpin,HIGH);
  for(int i=0; i < steptime; i++){
    digitalWrite(xsteppin,HIGH);
    delayMicroseconds(steptime);
    digitalWrite(xsteppin,LOW);
    delayMicroseconds(steptime);
  }
}

void forward2(int steptime){
  digitalWrite(ydirpin,HIGH);
  for(int i=0; i < steptime; i++){
    digitalWrite(ysteppin,HIGH);
    delayMicroseconds(steptime);
    digitalWrite(ysteppin,LOW);
    delayMicroseconds(steptime);
  }
}

void backward1(int steptime){
  digitalWrite(xdirpin,LOW);
  for(int i=0; i < steptime; i++){
    digitalWrite(xsteppin,HIGH);
    delayMicroseconds(steptime);
    digitalWrite(xsteppin,LOW);
    delayMicroseconds(steptime);
  }
}

void backward2(int steptime){
  digitalWrite(ydirpin,LOW);
  for(int i=0; i < steptime; i++){
    digitalWrite(ysteppin,HIGH);
    delayMicroseconds(steptime);
    digitalWrite(ysteppin,LOW);
    delayMicroseconds(steptime);
  }
  
}

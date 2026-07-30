#define Binary_h  // Prevent Arduino binary macros from conflicting with user variables
#include <Arduino.h>
#include <stdarg.h>

#define KRUMON_MOTOR_L_PWM 9
#define KRUMON_MOTOR_L_DIR 7
#define KRUMON_MOTOR_R_PWM 10
#define KRUMON_MOTOR_R_DIR 4
#define KRUMON_BUZZER 8
#define KRUMON_GRABBER 5

void _krumon_init() {
  pinMode(KRUMON_MOTOR_L_PWM, OUTPUT);
  pinMode(KRUMON_MOTOR_L_DIR, OUTPUT);
  pinMode(KRUMON_MOTOR_R_PWM, OUTPUT);
  pinMode(KRUMON_MOTOR_R_DIR, OUTPUT);
  pinMode(KRUMON_BUZZER, OUTPUT);
  pinMode(KRUMON_GRABBER, OUTPUT);
}
void sleep(int ms) {
  delay(ms);
}
void fd(int p) {
  int v = (p * 255) / 100;
  digitalWrite(KRUMON_MOTOR_L_DIR, LOW);
  digitalWrite(KRUMON_MOTOR_R_DIR, LOW);
  analogWrite(KRUMON_MOTOR_L_PWM, v);
  analogWrite(KRUMON_MOTOR_R_PWM, v);
}
void bk(int p) {
  int v = (p * 255) / 100;
  digitalWrite(KRUMON_MOTOR_L_DIR, HIGH);
  digitalWrite(KRUMON_MOTOR_R_DIR, HIGH);
  analogWrite(KRUMON_MOTOR_L_PWM, v);
  analogWrite(KRUMON_MOTOR_R_PWM, v);
}
void sl(int p) {
  int v = (p * 255) / 100;
  digitalWrite(KRUMON_MOTOR_L_DIR, HIGH);
  digitalWrite(KRUMON_MOTOR_R_DIR, LOW);
  analogWrite(KRUMON_MOTOR_L_PWM, v);
  analogWrite(KRUMON_MOTOR_R_PWM, v);
}
void sr(int p) {
  int v = (p * 255) / 100;
  digitalWrite(KRUMON_MOTOR_L_DIR, LOW);
  digitalWrite(KRUMON_MOTOR_R_DIR, HIGH);
  analogWrite(KRUMON_MOTOR_L_PWM, v);
  analogWrite(KRUMON_MOTOR_R_PWM, v);
}
void tl(int p) {
  int v = (p * 255) / 100;
  digitalWrite(KRUMON_MOTOR_L_DIR, LOW);
  digitalWrite(KRUMON_MOTOR_R_DIR, LOW);
  analogWrite(KRUMON_MOTOR_L_PWM, 0);
  analogWrite(KRUMON_MOTOR_R_PWM, v);
}
void tr(int p) {
  int v = (p * 255) / 100;
  digitalWrite(KRUMON_MOTOR_L_DIR, LOW);
  digitalWrite(KRUMON_MOTOR_R_DIR, LOW);
  analogWrite(KRUMON_MOTOR_L_PWM, v);
  analogWrite(KRUMON_MOTOR_R_PWM, 0);
}
void ao() {
  analogWrite(KRUMON_MOTOR_L_PWM, 0);
  analogWrite(KRUMON_MOTOR_R_PWM, 0);
}
void motor(int ch, int p) {
  int v = abs(p) * 255 / 100;
  bool dir = p < 0 ? HIGH : LOW;
  if (ch == 1) {
    digitalWrite(KRUMON_MOTOR_L_DIR, dir);
    analogWrite(KRUMON_MOTOR_L_PWM, v);
  }
  if (ch == 2) {
    digitalWrite(KRUMON_MOTOR_R_DIR, dir);
    analogWrite(KRUMON_MOTOR_R_PWM, v);
  }
}
void beep() {
  digitalWrite(KRUMON_BUZZER, HIGH);
  delay(100);
  digitalWrite(KRUMON_BUZZER, LOW);
}
void keylow(char note, int ms) {
  digitalWrite(KRUMON_BUZZER, HIGH);
  delay(ms);
  digitalWrite(KRUMON_BUZZER, LOW);
}
int analog(int ch) {
  return analogRead(A0 + ch);
}
int sw1() {
  return 0;
}
void sw1_press() {}
int sw_OK() {
  return 0;
}
void OK() {}
void grab(int state) {
  digitalWrite(KRUMON_GRABBER, state ? HIGH : LOW);
}
void keep_up() {
  digitalWrite(KRUMON_GRABBER, HIGH);
}
void keep_down() {
  digitalWrite(KRUMON_GRABBER, LOW);
}
void system_stop() {
  ao();
  while (1)
    ;
}

void lcd(const char* format, ...) {
  va_list args;
  va_start(args, format);
  Serial.print("[LCD]");
  while (*format != '\\0') {
    if (*format == '%') {
      format++;
      bool zeroPad = false;
      int width = 0;
      if (*format == '0') {
        zeroPad = true;
        format++;
      }
      while (*format >= '0' && *format <= '9') {
        width = width * 10 + (*format - '0');
        format++;
      }
      int decimals = 2;
      if (*format == '.') {
        format++;
        decimals = 0;
        while (*format >= '0' && *format <= '9') {
          decimals = decimals * 10 + (*format - '0');
          format++;
        }
      }
      if (*format == 'd' || *format == 'i' || *format == 'u') {
        String s = String(va_arg(args, int));
        while (s.length() < width) s = (zeroPad ? "0" : " ") + s;
        Serial.print(s);
      } else if (*format == 'l') {
        format++;
        if (*format == 'd' || *format == 'i' || *format == 'u') {
          String s = String(va_arg(args, long));
          while (s.length() < width) s = (zeroPad ? "0" : " ") + s;
          Serial.print(s);
        }
      } else if (*format == 'f') {
        double val = va_arg(args, double);
        char buf[32];
        dtostrf(val, width > 0 ? width : 1, decimals, buf);
        String s = String(buf);
        if (zeroPad) {
          s.trim();
          while (s.length() < width) s = "0" + s;
        }
        Serial.print(s);
      } else if (*format == 's') {
        Serial.print(va_arg(args, char*));
      } else if (*format == 'c') {
        Serial.print((char)va_arg(args, int));
      } else if (*format == '%') {
        Serial.print('%');
      } else {
        Serial.print('%');
        Serial.print(*format);
      }
    } else if (*format == '\\n') {
      Serial.print("\\\\n");
    } else {
      Serial.print(*format);
    }
    format++;
  }
  Serial.println();
  va_end(args);
}
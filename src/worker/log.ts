// Logs carry content-free metadata only. Never add a field that could hold
// Resume, Job Description, prompt or model text.
export interface LogEvent {
  event: string;
  step?: string;
  code?: string;
  status?: number;
  ms?: number;
  tokensIn?: number;
  tokensOut?: number;
}

export interface Logger {
  event(e: LogEvent): void;
}

export const consoleLogger: Logger = {
  event(e) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), ...e }));
  },
};

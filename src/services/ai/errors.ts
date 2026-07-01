/**
 * All AI service errors extend AIServiceError.
 * The `userMessage` field is safe to send to the client.
 */
export class AIServiceError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string = message
  ) {
    super(message);
    this.name = "AIServiceError";
  }
}

export class AIPermissionError extends AIServiceError {
  constructor(jobType: string, role: string) {
    const msg = `Role "${role}" cannot run job "${jobType}"`;
    super(msg, `คุณไม่มีสิทธิ์รัน ${jobType} — กรุณาติดต่อ Admin`);
    this.name = "AIPermissionError";
  }
}

export class AINoPromptError extends AIServiceError {
  constructor(promptType: string) {
    super(
      `No active prompt found for type: ${promptType}`,
      `ยังไม่มี Prompt ที่ active สำหรับ "${promptType}" — Admin ต้องไป Prompt Library แล้วกด Activate`
    );
    this.name = "AINoPromptError";
  }
}

export class AINoDataError extends AIServiceError {
  constructor(what: string) {
    super(`Required data not found: ${what}`, `ไม่พบข้อมูลที่จำเป็น: ${what}`);
    this.name = "AINoDataError";
  }
}

export class AIProviderError extends AIServiceError {
  constructor(detail: string, public readonly jobId: string) {
    super(
      `AI provider error: ${detail}`,
      `AI generation ล้มเหลว กรุณาลองใหม่ (Job ID: ${jobId})`
    );
    this.name = "AIProviderError";
  }
}

export class AIPreConditionError extends AIServiceError {
  constructor(message: string) {
    super(message, message);
    this.name = "AIPreConditionError";
  }
}

/** Helper — extract user-safe message for API responses */
export function toUserMessage(err: unknown): string {
  if (err instanceof AIServiceError) return err.userMessage;
  if (err instanceof Error) return err.message;
  return "เกิดข้อผิดพลาดที่ไม่รู้จัก กรุณาลองใหม่";
}

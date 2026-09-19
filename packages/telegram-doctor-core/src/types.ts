export type DoctorCheckStatus = "pass" | "fail" | "warn" | "skip";

export interface DoctorCheck {
  id: string;
  status: DoctorCheckStatus;
  message: string;
  /** Необязательная подсказка, как исправить. */
  fix?: string;
}

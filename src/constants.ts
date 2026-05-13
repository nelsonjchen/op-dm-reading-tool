export const API_BASE_URL = "https://api.comma.ai";
export const GITHUB_REPO_URL = "https://github.com/ophwug/op-calibration-reading-tool";

export const OPENPILOT_MASTER_SOURCES = {
  calibrationd:
    "https://github.com/commaai/openpilot/blob/master/selfdrive/locationd/calibrationd.py",
  deviceSettings:
    "https://github.com/commaai/openpilot/blob/master/selfdrive/ui/layouts/settings/device.py",
  logSchema: "https://github.com/commaai/openpilot/blob/master/cereal/log.capnp",
  commaApi: "https://api.comma.ai/",
  newConnectFileApi: "https://github.com/commaai/new-connect/blob/master/src/api/file.ts",
};

export const CALIBRATION_LIMITS = {
  default: {
    label: "Most devices",
    pitchMinRad: -0.09074112085129739,
    pitchMaxRad: 0.17,
    yawMinRad: -0.06912048084718224,
    yawMaxRad: 0.06912048084718235,
  },
  mici: {
    label: "mici / comma four",
    pitchMinRad: -0.143101,
    pitchMaxRad: 0.22235988,
    yawMinRad: -0.06912048084718224,
    yawMaxRad: 0.06912048084718235,
  },
} as const;

export const CALIBRATION_STATUS_NAMES: Record<number, string> = {
  0: "uncalibrated",
  1: "calibrated",
  2: "invalid",
  3: "recalibrating",
};

export const LIVE_CALIBRATION_UNION_TAG = 18;

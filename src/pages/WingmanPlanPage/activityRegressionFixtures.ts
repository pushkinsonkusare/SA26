export type ActivityRegressionFixture = {
  name: string;
  query: string;
  expectedSignals: string[];
  disallowedSignals: string[];
};

export const ACTIVITY_REGRESSION_FIXTURES: ActivityRegressionFixture[] = [
  {
    name: "scuba_diving",
    query: "gear for scuba diving",
    expectedSignals: ["waterproof", "underwater", "cam_action"],
    disallowedSignals: ["handlebar", "bike mount", "transmitter"],
  },
  {
    name: "road_cycling",
    query: "road cycling camera setup",
    expectedSignals: ["mount_handlebar", "cam_action", "sports"],
    disallowedSignals: ["underwater housing", "scuba"],
  },
  {
    name: "mountain_biking",
    query: "mountain biking kit",
    expectedSignals: ["mount_helmet", "cam_action", "rugged"],
    disallowedSignals: ["underwater housing", "lavalier"],
  },
  {
    name: "moto_vlogging",
    query: "moto vlogging setup",
    expectedSignals: ["mic_wireless", "mount_helmet", "cam_action"],
    disallowedSignals: ["scuba", "underwater", "bike-only mount"],
  },
  {
    name: "motocross",
    query: "motocross action camera gear",
    expectedSignals: ["cam_action", "mount_helmet", "rugged"],
    disallowedSignals: ["underwater housing", "podcast mic kit"],
  },
  {
    name: "paragliding",
    query: "paragliding recording setup",
    expectedSignals: ["cam_action", "mount_helmet", "stabilized"],
    disallowedSignals: ["underwater", "motocross"],
  },
  {
    name: "base_jumping",
    query: "base jumping camera kit",
    expectedSignals: ["cam_action", "mount_helmet", "compact"],
    disallowedSignals: ["underwater", "bike mount"],
  },
  {
    name: "skydiving",
    query: "skydiving camera setup",
    expectedSignals: ["cam_action", "mount_helmet", "sports"],
    disallowedSignals: ["handlebar", "bike mount", "motorcycle"],
  },
  {
    name: "whitewater_rafting",
    query: "whitewater rafting capture gear",
    expectedSignals: ["waterproof", "cam_action", "mount_wrist"],
    disallowedSignals: ["handlebar", "motorcycle"],
  },
  {
    name: "gym_fitness_creator",
    query: "gym fitness creator setup",
    expectedSignals: ["vlogging", "mic_wireless", "gimbal_phone"],
    disallowedSignals: ["underwater", "propeller"],
  },
  {
    name: "documentary_filmmaking",
    query: "documentary filmmaking kit",
    expectedSignals: ["drone_cinema", "gimbal_camera", "mic_wireless"],
    disallowedSignals: ["motocross", "handlebar"],
  },
];


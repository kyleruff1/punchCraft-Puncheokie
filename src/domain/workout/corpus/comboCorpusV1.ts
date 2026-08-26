export type ComboTier = 'beginner' | 'intermediate' | 'advanced';
export type PunchBase = '1' | '2' | '3' | '4' | '5' | '6';
export type PunchToken = PunchBase | `${PunchBase}B`;
export type ComboUse = 'fundamental' | 'tactical' | 'extended' | 'bag-chain';

export interface ComboDefinition {
  readonly id: string;
  readonly tier: ComboTier;
  readonly tokens: readonly PunchToken[];
  readonly notation: string;
  readonly compact: string;
  readonly spokenGroups: readonly (readonly PunchToken[])[];
  readonly phaseBreaksAfterToken: readonly number[];
  readonly name: string;
  readonly objective: string;
  readonly punchCount: number;
  readonly bodyShotCount: number;
  readonly jabLed: boolean;
  readonly range: string;
  readonly use: ComboUse;
}

export interface BuildUpStage {
  readonly stage: number;
  readonly tokens: readonly PunchToken[];
  readonly notation: string;
  readonly compact: string;
  readonly punchCount: number;
  readonly coreComboId: string | null;
}

export interface BuildUpSet {
  readonly id: string;
  readonly tier: ComboTier;
  readonly name: string;
  readonly method: string;
  readonly goal: string;
  readonly stages: readonly BuildUpStage[];
}

export const COMBO_CORPUS = [
  {
    "id": "B01",
    "tier": "beginner",
    "tokens": [
      "1",
      "2"
    ],
    "notation": "1-2",
    "compact": "12",
    "spokenGroups": [
      [
        "1",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [],
    "name": "Classic one-two",
    "objective": "Straight foundation",
    "punchCount": 2,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "long-to-mid",
    "use": "fundamental"
  },
  {
    "id": "B02",
    "tier": "beginner",
    "tokens": [
      "1",
      "1"
    ],
    "notation": "1-1",
    "compact": "11",
    "spokenGroups": [
      [
        "1",
        "1"
      ]
    ],
    "phaseBreaksAfterToken": [],
    "name": "Double jab",
    "objective": "Range finding and lead-hand rhythm",
    "punchCount": 2,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "long-to-mid",
    "use": "fundamental"
  },
  {
    "id": "B03",
    "tier": "beginner",
    "tokens": [
      "1",
      "1",
      "2"
    ],
    "notation": "1-1-2",
    "compact": "112",
    "spokenGroups": [
      [
        "1",
        "1"
      ],
      [
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Double-jab cross",
    "objective": "Close distance behind the jab",
    "punchCount": 3,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "long-to-mid",
    "use": "fundamental"
  },
  {
    "id": "B04",
    "tier": "beginner",
    "tokens": [
      "1",
      "2",
      "1"
    ],
    "notation": "1-2-1",
    "compact": "121",
    "spokenGroups": [
      [
        "1",
        "2"
      ],
      [
        "1"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Return jab",
    "objective": "Recover behind the lead hand",
    "punchCount": 3,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "long-to-mid",
    "use": "fundamental"
  },
  {
    "id": "B05",
    "tier": "beginner",
    "tokens": [
      "1",
      "2",
      "1",
      "2"
    ],
    "notation": "1-2-1-2",
    "compact": "1212",
    "spokenGroups": [
      [
        "1",
        "2"
      ],
      [
        "1",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Straight repeat",
    "objective": "Alternating straight-punch rhythm",
    "punchCount": 4,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "long-to-mid",
    "use": "fundamental"
  },
  {
    "id": "B06",
    "tier": "beginner",
    "tokens": [
      "1",
      "3"
    ],
    "notation": "1-3",
    "compact": "13",
    "spokenGroups": [
      [
        "1",
        "3"
      ]
    ],
    "phaseBreaksAfterToken": [],
    "name": "Jab to lead hook",
    "objective": "Same-lead-hand angle change",
    "punchCount": 2,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "fundamental"
  },
  {
    "id": "B07",
    "tier": "beginner",
    "tokens": [
      "1",
      "4"
    ],
    "notation": "1-4",
    "compact": "14",
    "spokenGroups": [
      [
        "1",
        "4"
      ]
    ],
    "phaseBreaksAfterToken": [],
    "name": "Jab to rear hook",
    "objective": "Close-range rear-hand angle",
    "punchCount": 2,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "fundamental"
  },
  {
    "id": "B08",
    "tier": "beginner",
    "tokens": [
      "1",
      "5"
    ],
    "notation": "1-5",
    "compact": "15",
    "spokenGroups": [
      [
        "1",
        "5"
      ]
    ],
    "phaseBreaksAfterToken": [],
    "name": "Jab to lead uppercut",
    "objective": "Same-lead-hand vertical change",
    "punchCount": 2,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "fundamental"
  },
  {
    "id": "B09",
    "tier": "beginner",
    "tokens": [
      "1",
      "6"
    ],
    "notation": "1-6",
    "compact": "16",
    "spokenGroups": [
      [
        "1",
        "6"
      ]
    ],
    "phaseBreaksAfterToken": [],
    "name": "Jab to rear uppercut",
    "objective": "Close-range rear-hand vertical change",
    "punchCount": 2,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "fundamental"
  },
  {
    "id": "B10",
    "tier": "beginner",
    "tokens": [
      "1",
      "2",
      "3"
    ],
    "notation": "1-2-3",
    "compact": "123",
    "spokenGroups": [
      [
        "1",
        "2"
      ],
      [
        "3"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Three-punch fundamental",
    "objective": "Straight-to-hook finish",
    "punchCount": 3,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "fundamental"
  },
  {
    "id": "B11",
    "tier": "beginner",
    "tokens": [
      "1",
      "2",
      "3",
      "2"
    ],
    "notation": "1-2-3-2",
    "compact": "1232",
    "spokenGroups": [
      [
        "1",
        "2"
      ],
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Four-punch fundamental",
    "objective": "Hook-cross finish",
    "punchCount": 4,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "fundamental"
  },
  {
    "id": "B12",
    "tier": "beginner",
    "tokens": [
      "1",
      "6",
      "3"
    ],
    "notation": "1-6-3",
    "compact": "163",
    "spokenGroups": [
      [
        "1",
        "6"
      ],
      [
        "3"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Uppercut-hook bridge",
    "objective": "Rear uppercut into lead hook",
    "punchCount": 3,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "fundamental"
  },
  {
    "id": "B13",
    "tier": "beginner",
    "tokens": [
      "3",
      "2"
    ],
    "notation": "3-2",
    "compact": "32",
    "spokenGroups": [
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [],
    "name": "Hook-cross",
    "objective": "Pocket-range power pair",
    "punchCount": 2,
    "bodyShotCount": 0,
    "jabLed": false,
    "range": "closing-to-mid",
    "use": "fundamental"
  },
  {
    "id": "B14",
    "tier": "beginner",
    "tokens": [
      "1",
      "3",
      "6"
    ],
    "notation": "1-3-6",
    "compact": "136",
    "spokenGroups": [
      [
        "1",
        "3"
      ],
      [
        "6"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Jab-hook-uppercut",
    "objective": "Angle-to-vertical transition",
    "punchCount": 3,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "fundamental"
  },
  {
    "id": "B15",
    "tier": "beginner",
    "tokens": [
      "1",
      "5",
      "2"
    ],
    "notation": "1-5-2",
    "compact": "152",
    "spokenGroups": [
      [
        "1",
        "5"
      ],
      [
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Jab-uppercut-cross",
    "objective": "Lift the guard and finish straight",
    "punchCount": 3,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "fundamental"
  },
  {
    "id": "B16",
    "tier": "beginner",
    "tokens": [
      "1B",
      "2"
    ],
    "notation": "1B-2",
    "compact": "1B2",
    "spokenGroups": [
      [
        "1B",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [],
    "name": "Body-jab entry",
    "objective": "Change level before the cross",
    "punchCount": 2,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "long-to-mid",
    "use": "fundamental"
  },
  {
    "id": "B17",
    "tier": "beginner",
    "tokens": [
      "1",
      "2B"
    ],
    "notation": "1-2B",
    "compact": "12B",
    "spokenGroups": [
      [
        "1",
        "2B"
      ]
    ],
    "phaseBreaksAfterToken": [],
    "name": "Jab to body cross",
    "objective": "Straight level change",
    "punchCount": 2,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "long-to-mid",
    "use": "fundamental"
  },
  {
    "id": "B18",
    "tier": "beginner",
    "tokens": [
      "1B",
      "1",
      "2"
    ],
    "notation": "1B-1-2",
    "compact": "1B12",
    "spokenGroups": [
      [
        "1B",
        "1"
      ],
      [
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Body-head double jab",
    "objective": "Lead-hand level change",
    "punchCount": 3,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "long-to-mid",
    "use": "fundamental"
  },
  {
    "id": "B19",
    "tier": "beginner",
    "tokens": [
      "1",
      "2",
      "3B"
    ],
    "notation": "1-2-3B",
    "compact": "123B",
    "spokenGroups": [
      [
        "1",
        "2"
      ],
      [
        "3B"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Body-hook finish",
    "objective": "Finish downstairs",
    "punchCount": 3,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "fundamental"
  },
  {
    "id": "B20",
    "tier": "beginner",
    "tokens": [
      "1",
      "1",
      "1",
      "2B"
    ],
    "notation": "1-1-1-2B",
    "compact": "1112B",
    "spokenGroups": [
      [
        "1",
        "1",
        "1"
      ],
      [
        "2B"
      ]
    ],
    "phaseBreaksAfterToken": [
      3
    ],
    "name": "Jab wall to body cross",
    "objective": "Raise the guard, finish to the body",
    "punchCount": 4,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "long-to-mid",
    "use": "fundamental"
  },
  {
    "id": "I01",
    "tier": "intermediate",
    "tokens": [
      "1",
      "1",
      "2",
      "3",
      "2"
    ],
    "notation": "1-1-2-3-2",
    "compact": "11232",
    "spokenGroups": [
      [
        "1",
        "1",
        "2"
      ],
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      3
    ],
    "name": "Double-jab power finish",
    "objective": "Layer a hook-cross finish",
    "punchCount": 5,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "tactical"
  },
  {
    "id": "I02",
    "tier": "intermediate",
    "tokens": [
      "1",
      "2",
      "3",
      "2",
      "3"
    ],
    "notation": "1-2-3-2-3",
    "compact": "12323",
    "spokenGroups": [
      [
        "1",
        "2"
      ],
      [
        "3",
        "2",
        "3"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Alternating hook finish",
    "objective": "Repeat the lead hook",
    "punchCount": 5,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "tactical"
  },
  {
    "id": "I03",
    "tier": "intermediate",
    "tokens": [
      "1",
      "3",
      "2",
      "3",
      "2"
    ],
    "notation": "1-3-2-3-2",
    "compact": "13232",
    "spokenGroups": [
      [
        "1",
        "3"
      ],
      [
        "2",
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Lead-side entry chain",
    "objective": "Same-side setup into pocket rhythm",
    "punchCount": 5,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "tactical"
  },
  {
    "id": "I04",
    "tier": "intermediate",
    "tokens": [
      "2",
      "3",
      "2"
    ],
    "notation": "2-3-2",
    "compact": "232",
    "spokenGroups": [
      [
        "2",
        "3"
      ],
      [
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Pocket three",
    "objective": "Cross-hook-cross without a jab",
    "punchCount": 3,
    "bodyShotCount": 0,
    "jabLed": false,
    "range": "closing-to-mid",
    "use": "tactical"
  },
  {
    "id": "I05",
    "tier": "intermediate",
    "tokens": [
      "2",
      "6",
      "3"
    ],
    "notation": "2-6-3",
    "compact": "263",
    "spokenGroups": [
      [
        "2",
        "6"
      ],
      [
        "3"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Cross-uppercut-hook",
    "objective": "Rear-hand reload into lead hook",
    "punchCount": 3,
    "bodyShotCount": 0,
    "jabLed": false,
    "range": "closing-to-mid-close",
    "use": "tactical"
  },
  {
    "id": "I06",
    "tier": "intermediate",
    "tokens": [
      "2",
      "3B",
      "5"
    ],
    "notation": "2-3B-5",
    "compact": "23B5",
    "spokenGroups": [
      [
        "2",
        "3B"
      ],
      [
        "5"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Cross-body hook-uppercut",
    "objective": "Body reaction into vertical finish",
    "punchCount": 3,
    "bodyShotCount": 1,
    "jabLed": false,
    "range": "closing-to-mid-close",
    "use": "tactical"
  },
  {
    "id": "I07",
    "tier": "intermediate",
    "tokens": [
      "1",
      "5",
      "2",
      "3",
      "2"
    ],
    "notation": "1-5-2-3-2",
    "compact": "15232",
    "spokenGroups": [
      [
        "1",
        "5"
      ],
      [
        "2",
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Lead-uppercut disguise",
    "objective": "Replace the second jab with a vertical shot",
    "punchCount": 5,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "tactical"
  },
  {
    "id": "I08",
    "tier": "intermediate",
    "tokens": [
      "1",
      "2",
      "5",
      "6",
      "3",
      "2"
    ],
    "notation": "1-2-5-6-3-2",
    "compact": "125632",
    "spokenGroups": [
      [
        "1",
        "2"
      ],
      [
        "5",
        "6"
      ],
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2,
      4
    ],
    "name": "Six-punch fundamentals chain",
    "objective": "Straights, uppercuts, hooks",
    "punchCount": 6,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "extended"
  },
  {
    "id": "I09",
    "tier": "intermediate",
    "tokens": [
      "1",
      "2",
      "3",
      "6",
      "3"
    ],
    "notation": "1-2-3-6-3",
    "compact": "12363",
    "spokenGroups": [
      [
        "1",
        "2"
      ],
      [
        "3",
        "6",
        "3"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Hook-uppercut-hook",
    "objective": "Rotational close-range sequence",
    "punchCount": 5,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "tactical"
  },
  {
    "id": "I10",
    "tier": "intermediate",
    "tokens": [
      "1",
      "2",
      "4",
      "3",
      "2"
    ],
    "notation": "1-2-4-3-2",
    "compact": "12432",
    "spokenGroups": [
      [
        "1",
        "2",
        "4"
      ],
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      3
    ],
    "name": "Rear-hook reload",
    "objective": "Same-rear-hand angle change",
    "punchCount": 5,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "tactical"
  },
  {
    "id": "I11",
    "tier": "intermediate",
    "tokens": [
      "1",
      "4",
      "2",
      "3"
    ],
    "notation": "1-4-2-3",
    "compact": "1423",
    "spokenGroups": [
      [
        "1",
        "4"
      ],
      [
        "2",
        "3"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Square",
    "objective": "Four-corner hand pattern",
    "punchCount": 4,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "tactical"
  },
  {
    "id": "I12",
    "tier": "intermediate",
    "tokens": [
      "1",
      "4",
      "2",
      "3",
      "6"
    ],
    "notation": "1-4-2-3-6",
    "compact": "14236",
    "spokenGroups": [
      [
        "1",
        "4"
      ],
      [
        "2",
        "3"
      ],
      [
        "6"
      ]
    ],
    "phaseBreaksAfterToken": [
      2,
      4
    ],
    "name": "Square plus rear uppercut",
    "objective": "Extend the square downward",
    "punchCount": 5,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "tactical"
  },
  {
    "id": "I13",
    "tier": "intermediate",
    "tokens": [
      "1B",
      "2",
      "3",
      "2"
    ],
    "notation": "1B-2-3-2",
    "compact": "1B232",
    "spokenGroups": [
      [
        "1B",
        "2"
      ],
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Body-jab power line",
    "objective": "Enter low, finish high",
    "punchCount": 4,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "tactical"
  },
  {
    "id": "I14",
    "tier": "intermediate",
    "tokens": [
      "1",
      "2B",
      "3",
      "2"
    ],
    "notation": "1-2B-3-2",
    "compact": "12B32",
    "spokenGroups": [
      [
        "1",
        "2B"
      ],
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Body cross to hook-cross",
    "objective": "Mid-combination level change",
    "punchCount": 4,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "tactical"
  },
  {
    "id": "I15",
    "tier": "intermediate",
    "tokens": [
      "1",
      "2",
      "3B",
      "3",
      "2"
    ],
    "notation": "1-2-3B-3-2",
    "compact": "123B32",
    "spokenGroups": [
      [
        "1",
        "2"
      ],
      [
        "3B",
        "3"
      ],
      [
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2,
      4
    ],
    "name": "Body-head lead hook",
    "objective": "Double the lead hook across levels",
    "punchCount": 5,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "tactical"
  },
  {
    "id": "I16",
    "tier": "intermediate",
    "tokens": [
      "1",
      "1",
      "2",
      "3B",
      "2"
    ],
    "notation": "1-1-2-3B-2",
    "compact": "1123B2",
    "spokenGroups": [
      [
        "1",
        "1",
        "2"
      ],
      [
        "3B",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      3
    ],
    "name": "Double-jab body finish",
    "objective": "High-volume entry and body hook",
    "punchCount": 5,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "tactical"
  },
  {
    "id": "I17",
    "tier": "intermediate",
    "tokens": [
      "1B",
      "2B",
      "3",
      "2"
    ],
    "notation": "1B-2B-3-2",
    "compact": "1B2B32",
    "spokenGroups": [
      [
        "1B",
        "2B"
      ],
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Body straights to head",
    "objective": "Two-level attack",
    "punchCount": 4,
    "bodyShotCount": 2,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "tactical"
  },
  {
    "id": "I18",
    "tier": "intermediate",
    "tokens": [
      "1",
      "1",
      "4B"
    ],
    "notation": "1-1-4B",
    "compact": "114B",
    "spokenGroups": [
      [
        "1",
        "1"
      ],
      [
        "4B"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Double-jab rear body hook",
    "objective": "High guard setup to rear body hook",
    "punchCount": 3,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "tactical"
  },
  {
    "id": "I19",
    "tier": "intermediate",
    "tokens": [
      "1",
      "2",
      "6B",
      "3",
      "2"
    ],
    "notation": "1-2-6B-3-2",
    "compact": "126B32",
    "spokenGroups": [
      [
        "1",
        "2"
      ],
      [
        "6B"
      ],
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2,
      3
    ],
    "name": "Rear body uppercut reload",
    "objective": "Rear-hand body attack to head finish",
    "punchCount": 5,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "tactical"
  },
  {
    "id": "I20",
    "tier": "intermediate",
    "tokens": [
      "1B",
      "1",
      "2",
      "5",
      "2"
    ],
    "notation": "1B-1-2-5-2",
    "compact": "1B1252",
    "spokenGroups": [
      [
        "1B",
        "1",
        "2"
      ],
      [
        "5",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      3
    ],
    "name": "Body-head jab ladder",
    "objective": "Multi-level entry into uppercut",
    "punchCount": 5,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "tactical"
  },
  {
    "id": "A01",
    "tier": "advanced",
    "tokens": [
      "1",
      "4",
      "2",
      "3",
      "6",
      "5"
    ],
    "notation": "1-4-2-3-6-5",
    "compact": "142365",
    "spokenGroups": [
      [
        "1",
        "4"
      ],
      [
        "2",
        "3"
      ],
      [
        "6",
        "5"
      ]
    ],
    "phaseBreaksAfterToken": [
      2,
      4
    ],
    "name": "Square uppercut ladder",
    "objective": "requested 142365 build",
    "punchCount": 6,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "extended"
  },
  {
    "id": "A02",
    "tier": "advanced",
    "tokens": [
      "1",
      "4",
      "2",
      "3",
      "6",
      "5",
      "2"
    ],
    "notation": "1-4-2-3-6-5-2",
    "compact": "1423652",
    "spokenGroups": [
      [
        "1",
        "4"
      ],
      [
        "2",
        "3"
      ],
      [
        "6",
        "5",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2,
      4
    ],
    "name": "Square with cross finish",
    "objective": "complete square ladder with rear straight",
    "punchCount": 7,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "bag-chain"
  },
  {
    "id": "A03",
    "tier": "advanced",
    "tokens": [
      "1",
      "4",
      "2",
      "3",
      "6",
      "5",
      "3",
      "2"
    ],
    "notation": "1-4-2-3-6-5-3-2",
    "compact": "14236532",
    "spokenGroups": [
      [
        "1",
        "4"
      ],
      [
        "2",
        "3"
      ],
      [
        "6",
        "5"
      ],
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2,
      4,
      6
    ],
    "name": "Extended square",
    "objective": "full angle-to-uppercut-to-hook chain",
    "punchCount": 8,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "bag-chain"
  },
  {
    "id": "A04",
    "tier": "advanced",
    "tokens": [
      "1",
      "1",
      "2",
      "3B",
      "3",
      "2"
    ],
    "notation": "1-1-2-3B-3-2",
    "compact": "1123B32",
    "spokenGroups": [
      [
        "1",
        "1",
        "2"
      ],
      [
        "3B",
        "3"
      ],
      [
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      3,
      5
    ],
    "name": "Double-jab body-head hook",
    "objective": "same-hand level double",
    "punchCount": 6,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "extended"
  },
  {
    "id": "A05",
    "tier": "advanced",
    "tokens": [
      "1",
      "1",
      "2",
      "3B",
      "3",
      "2",
      "5",
      "2"
    ],
    "notation": "1-1-2-3B-3-2-5-2",
    "compact": "1123B3252",
    "spokenGroups": [
      [
        "1",
        "1",
        "2"
      ],
      [
        "3B",
        "3",
        "2"
      ],
      [
        "5",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      3,
      6
    ],
    "name": "Body-head pressure ladder",
    "objective": "extend the lead-hook double",
    "punchCount": 8,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "bag-chain"
  },
  {
    "id": "A06",
    "tier": "advanced",
    "tokens": [
      "1B",
      "1",
      "2",
      "3",
      "6",
      "3",
      "2"
    ],
    "notation": "1B-1-2-3-6-3-2",
    "compact": "1B123632",
    "spokenGroups": [
      [
        "1B",
        "1",
        "2"
      ],
      [
        "3",
        "6",
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      3
    ],
    "name": "Body-head entry to pocket chain",
    "objective": "two-phase attack",
    "punchCount": 7,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "bag-chain"
  },
  {
    "id": "A07",
    "tier": "advanced",
    "tokens": [
      "1",
      "2B",
      "3B",
      "2",
      "3",
      "2"
    ],
    "notation": "1-2B-3B-2-3-2",
    "compact": "12B3B232",
    "spokenGroups": [
      [
        "1",
        "2B",
        "3B"
      ],
      [
        "2",
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      3
    ],
    "name": "Double-body to head pressure",
    "objective": "two body shots then head finish",
    "punchCount": 6,
    "bodyShotCount": 2,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "extended"
  },
  {
    "id": "A08",
    "tier": "advanced",
    "tokens": [
      "1B",
      "2B",
      "3",
      "6",
      "3",
      "2"
    ],
    "notation": "1B-2B-3-6-3-2",
    "compact": "1B2B3632",
    "spokenGroups": [
      [
        "1B",
        "2B"
      ],
      [
        "3",
        "6",
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2
    ],
    "name": "Body staircase",
    "objective": "rise from straight body shots to head",
    "punchCount": 6,
    "bodyShotCount": 2,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "extended"
  },
  {
    "id": "A09",
    "tier": "advanced",
    "tokens": [
      "1",
      "2",
      "5B",
      "6B",
      "3",
      "2"
    ],
    "notation": "1-2-5B-6B-3-2",
    "compact": "125B6B32",
    "spokenGroups": [
      [
        "1",
        "2"
      ],
      [
        "5B",
        "6B"
      ],
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2,
      4
    ],
    "name": "Double body uppercut",
    "objective": "vertical body attack to head finish",
    "punchCount": 6,
    "bodyShotCount": 2,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "extended"
  },
  {
    "id": "A10",
    "tier": "advanced",
    "tokens": [
      "1",
      "5",
      "2",
      "3B",
      "3",
      "2"
    ],
    "notation": "1-5-2-3B-3-2",
    "compact": "1523B32",
    "spokenGroups": [
      [
        "1",
        "5",
        "2"
      ],
      [
        "3B",
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      3
    ],
    "name": "Lead disguise and body-head hook",
    "objective": "two same-lead-hand concepts",
    "punchCount": 6,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "extended"
  },
  {
    "id": "A11",
    "tier": "advanced",
    "tokens": [
      "1",
      "2",
      "3",
      "6",
      "3",
      "2",
      "3",
      "2"
    ],
    "notation": "1-2-3-6-3-2-3-2",
    "compact": "12363232",
    "spokenGroups": [
      [
        "1",
        "2"
      ],
      [
        "3",
        "6",
        "3",
        "2"
      ],
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2,
      6
    ],
    "name": "Rolling pressure chain",
    "objective": "repeat hook-cross finish",
    "punchCount": 8,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "bag-chain"
  },
  {
    "id": "A12",
    "tier": "advanced",
    "tokens": [
      "1",
      "2",
      "5",
      "6",
      "3",
      "2",
      "3",
      "2"
    ],
    "notation": "1-2-5-6-3-2-3-2",
    "compact": "12563232",
    "spokenGroups": [
      [
        "1",
        "2"
      ],
      [
        "5",
        "6"
      ],
      [
        "3",
        "2"
      ],
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2,
      4,
      6
    ],
    "name": "Eight-punch alternating chain",
    "objective": "high-volume bag sequence",
    "punchCount": 8,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "bag-chain"
  },
  {
    "id": "A13",
    "tier": "advanced",
    "tokens": [
      "1",
      "6",
      "3",
      "2",
      "5",
      "2"
    ],
    "notation": "1-6-3-2-5-2",
    "compact": "163252",
    "spokenGroups": [
      [
        "1",
        "6"
      ],
      [
        "3",
        "2"
      ],
      [
        "5",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2,
      4
    ],
    "name": "Uppercut bridge extension",
    "objective": "two vertical-shot phases",
    "punchCount": 6,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "extended"
  },
  {
    "id": "A14",
    "tier": "advanced",
    "tokens": [
      "1",
      "3",
      "2",
      "5",
      "2",
      "3",
      "2"
    ],
    "notation": "1-3-2-5-2-3-2",
    "compact": "1325232",
    "spokenGroups": [
      [
        "1",
        "3"
      ],
      [
        "2",
        "5",
        "2"
      ],
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      2,
      5
    ],
    "name": "Lead-side deception chain",
    "objective": "layer hook and uppercut inserts",
    "punchCount": 7,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "bag-chain"
  },
  {
    "id": "A15",
    "tier": "advanced",
    "tokens": [
      "1",
      "2",
      "4",
      "3",
      "6",
      "3",
      "2"
    ],
    "notation": "1-2-4-3-6-3-2",
    "compact": "1243632",
    "spokenGroups": [
      [
        "1",
        "2",
        "4"
      ],
      [
        "3",
        "6",
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      3
    ],
    "name": "Rear-hook to pocket chain",
    "objective": "advanced same-rear-hand reload",
    "punchCount": 7,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "bag-chain"
  },
  {
    "id": "A16",
    "tier": "advanced",
    "tokens": [
      "1",
      "1",
      "2",
      "4",
      "3",
      "2"
    ],
    "notation": "1-1-2-4-3-2",
    "compact": "112432",
    "spokenGroups": [
      [
        "1",
        "1",
        "2",
        "4"
      ],
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      4
    ],
    "name": "Double-jab rear-hook reload",
    "objective": "rear-hand angle change",
    "punchCount": 6,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "extended"
  },
  {
    "id": "A17",
    "tier": "advanced",
    "tokens": [
      "1B",
      "2",
      "3",
      "2B",
      "3",
      "2"
    ],
    "notation": "1B-2-3-2B-3-2",
    "compact": "1B232B32",
    "spokenGroups": [
      [
        "1B",
        "2",
        "3"
      ],
      [
        "2B",
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      3
    ],
    "name": "Alternating level waves",
    "objective": "body-head-body-head pattern",
    "punchCount": 6,
    "bodyShotCount": 2,
    "jabLed": true,
    "range": "closing-to-mid",
    "use": "extended"
  },
  {
    "id": "A18",
    "tier": "advanced",
    "tokens": [
      "1",
      "2B",
      "3",
      "2",
      "5B",
      "2"
    ],
    "notation": "1-2B-3-2-5B-2",
    "compact": "12B325B2",
    "spokenGroups": [
      [
        "1",
        "2B",
        "3"
      ],
      [
        "2",
        "5B",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      3
    ],
    "name": "Body cross and body uppercut",
    "objective": "two separated body attacks",
    "punchCount": 6,
    "bodyShotCount": 2,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "extended"
  },
  {
    "id": "A19",
    "tier": "advanced",
    "tokens": [
      "1",
      "2",
      "3B",
      "6",
      "3",
      "2",
      "5",
      "2"
    ],
    "notation": "1-2-3B-6-3-2-5-2",
    "compact": "123B63252",
    "spokenGroups": [
      [
        "1",
        "2",
        "3B"
      ],
      [
        "6",
        "3",
        "2"
      ],
      [
        "5",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      3,
      6
    ],
    "name": "Body hook into uppercut chain",
    "objective": "three-phase pressure sequence",
    "punchCount": 8,
    "bodyShotCount": 1,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "bag-chain"
  },
  {
    "id": "A20",
    "tier": "advanced",
    "tokens": [
      "1",
      "1",
      "2",
      "3",
      "2",
      "5",
      "6",
      "3",
      "2"
    ],
    "notation": "1-1-2-3-2-5-6-3-2",
    "compact": "112325632",
    "spokenGroups": [
      [
        "1",
        "1",
        "2"
      ],
      [
        "3",
        "2"
      ],
      [
        "5",
        "6"
      ],
      [
        "3",
        "2"
      ]
    ],
    "phaseBreaksAfterToken": [
      3,
      5,
      7
    ],
    "name": "Nine-punch conditioning chain",
    "objective": "Extended memory, rhythm, and bag-volume sequence",
    "punchCount": 9,
    "bodyShotCount": 0,
    "jabLed": true,
    "range": "closing-to-mid-close",
    "use": "bag-chain"
  }
] as const satisfies readonly ComboDefinition[];

export const BUILD_UP_SETS = [
  {
    "id": "BB01",
    "tier": "beginner",
    "name": "Straight Extension",
    "method": "Add one straight punch at the tail while preserving the opening rhythm.",
    "goal": "Learn lead/rear alternation and return to stance.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1"
        ],
        "notation": "1",
        "compact": "1",
        "punchCount": 1,
        "coreComboId": null
      },
      {
        "stage": 2,
        "tokens": [
          "1",
          "2"
        ],
        "notation": "1-2",
        "compact": "12",
        "punchCount": 2,
        "coreComboId": "B01"
      },
      {
        "stage": 3,
        "tokens": [
          "1",
          "2",
          "1"
        ],
        "notation": "1-2-1",
        "compact": "121",
        "punchCount": 3,
        "coreComboId": "B04"
      },
      {
        "stage": 4,
        "tokens": [
          "1",
          "2",
          "1",
          "2"
        ],
        "notation": "1-2-1-2",
        "compact": "1212",
        "punchCount": 4,
        "coreComboId": "B05"
      }
    ]
  },
  {
    "id": "BB02",
    "tier": "beginner",
    "name": "Jab Volume Ladder",
    "method": "Increase the number of range-finding jabs before the rear hand.",
    "goal": "Build jab volume and finish after drawing a high guard.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1"
        ],
        "notation": "1",
        "compact": "1",
        "punchCount": 1,
        "coreComboId": null
      },
      {
        "stage": 2,
        "tokens": [
          "1",
          "1"
        ],
        "notation": "1-1",
        "compact": "11",
        "punchCount": 2,
        "coreComboId": "B02"
      },
      {
        "stage": 3,
        "tokens": [
          "1",
          "1",
          "2"
        ],
        "notation": "1-1-2",
        "compact": "112",
        "punchCount": 3,
        "coreComboId": "B03"
      },
      {
        "stage": 4,
        "tokens": [
          "1",
          "1",
          "1",
          "2B"
        ],
        "notation": "1-1-1-2B",
        "compact": "1112B",
        "punchCount": 4,
        "coreComboId": "B20"
      }
    ]
  },
  {
    "id": "BB03",
    "tier": "beginner",
    "name": "Hook Finish Ladder",
    "method": "Build the classic one-two into a hook and then a hook-cross finish.",
    "goal": "Move from straight punches to a lateral finishing angle.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1",
          "2"
        ],
        "notation": "1-2",
        "compact": "12",
        "punchCount": 2,
        "coreComboId": "B01"
      },
      {
        "stage": 2,
        "tokens": [
          "1",
          "2",
          "3"
        ],
        "notation": "1-2-3",
        "compact": "123",
        "punchCount": 3,
        "coreComboId": "B10"
      },
      {
        "stage": 3,
        "tokens": [
          "1",
          "2",
          "3",
          "2"
        ],
        "notation": "1-2-3-2",
        "compact": "1232",
        "punchCount": 4,
        "coreComboId": "B11"
      },
      {
        "stage": 4,
        "tokens": [
          "1",
          "2",
          "3",
          "2",
          "3"
        ],
        "notation": "1-2-3-2-3",
        "compact": "12323",
        "punchCount": 5,
        "coreComboId": "I02"
      }
    ]
  },
  {
    "id": "BB04",
    "tier": "beginner",
    "name": "Lead-Side Disguise",
    "method": "Keep the opening jab constant and change the second lead-hand action.",
    "goal": "Develop same-hand reloads without losing balance.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1"
        ],
        "notation": "1",
        "compact": "1",
        "punchCount": 1,
        "coreComboId": null
      },
      {
        "stage": 2,
        "tokens": [
          "1",
          "3"
        ],
        "notation": "1-3",
        "compact": "13",
        "punchCount": 2,
        "coreComboId": "B06"
      },
      {
        "stage": 3,
        "tokens": [
          "1",
          "3",
          "2"
        ],
        "notation": "1-3-2",
        "compact": "132",
        "punchCount": 3,
        "coreComboId": null
      },
      {
        "stage": 4,
        "tokens": [
          "1",
          "3",
          "2",
          "3"
        ],
        "notation": "1-3-2-3",
        "compact": "1323",
        "punchCount": 4,
        "coreComboId": null
      }
    ]
  },
  {
    "id": "BB05",
    "tier": "beginner",
    "name": "Body-Jab Rise",
    "method": "Start low, then add high-line punches one at a time.",
    "goal": "Introduce a simple body-to-head level change.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1B"
        ],
        "notation": "1B",
        "compact": "1B",
        "punchCount": 1,
        "coreComboId": null
      },
      {
        "stage": 2,
        "tokens": [
          "1B",
          "2"
        ],
        "notation": "1B-2",
        "compact": "1B2",
        "punchCount": 2,
        "coreComboId": "B16"
      },
      {
        "stage": 3,
        "tokens": [
          "1B",
          "2",
          "3"
        ],
        "notation": "1B-2-3",
        "compact": "1B23",
        "punchCount": 3,
        "coreComboId": null
      },
      {
        "stage": 4,
        "tokens": [
          "1B",
          "2",
          "3",
          "2"
        ],
        "notation": "1B-2-3-2",
        "compact": "1B232",
        "punchCount": 4,
        "coreComboId": "I13"
      }
    ]
  },
  {
    "id": "BB06",
    "tier": "beginner",
    "name": "Body-Hook Finish",
    "method": "Replace the lead hook to the head with a body hook, then build back upstairs.",
    "goal": "Teach body-head transitions and a balanced rear-hand finish.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1",
          "2"
        ],
        "notation": "1-2",
        "compact": "12",
        "punchCount": 2,
        "coreComboId": "B01"
      },
      {
        "stage": 2,
        "tokens": [
          "1",
          "2",
          "3B"
        ],
        "notation": "1-2-3B",
        "compact": "123B",
        "punchCount": 3,
        "coreComboId": "B19"
      },
      {
        "stage": 3,
        "tokens": [
          "1",
          "2",
          "3B",
          "2"
        ],
        "notation": "1-2-3B-2",
        "compact": "123B2",
        "punchCount": 4,
        "coreComboId": null
      },
      {
        "stage": 4,
        "tokens": [
          "1",
          "2",
          "3B",
          "3",
          "2"
        ],
        "notation": "1-2-3B-3-2",
        "compact": "123B32",
        "punchCount": 5,
        "coreComboId": "I15"
      }
    ]
  },
  {
    "id": "IB01",
    "tier": "intermediate",
    "name": "Double-Jab Power Chain",
    "method": "Use the double jab as the fixed entry and grow the power finish.",
    "goal": "Close range behind lead-hand volume.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1",
          "1"
        ],
        "notation": "1-1",
        "compact": "11",
        "punchCount": 2,
        "coreComboId": "B02"
      },
      {
        "stage": 2,
        "tokens": [
          "1",
          "1",
          "2"
        ],
        "notation": "1-1-2",
        "compact": "112",
        "punchCount": 3,
        "coreComboId": "B03"
      },
      {
        "stage": 3,
        "tokens": [
          "1",
          "1",
          "2",
          "3"
        ],
        "notation": "1-1-2-3",
        "compact": "1123",
        "punchCount": 4,
        "coreComboId": null
      },
      {
        "stage": 4,
        "tokens": [
          "1",
          "1",
          "2",
          "3",
          "2"
        ],
        "notation": "1-1-2-3-2",
        "compact": "11232",
        "punchCount": 5,
        "coreComboId": "I01"
      }
    ]
  },
  {
    "id": "IB02",
    "tier": "intermediate",
    "name": "Square Builder",
    "method": "Trace the app's square family, then extend into the rear uppercut.",
    "goal": "Train same-rear-hand reloads and changing punch planes.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1",
          "4"
        ],
        "notation": "1-4",
        "compact": "14",
        "punchCount": 2,
        "coreComboId": "B07"
      },
      {
        "stage": 2,
        "tokens": [
          "1",
          "4",
          "2"
        ],
        "notation": "1-4-2",
        "compact": "142",
        "punchCount": 3,
        "coreComboId": null
      },
      {
        "stage": 3,
        "tokens": [
          "1",
          "4",
          "2",
          "3"
        ],
        "notation": "1-4-2-3",
        "compact": "1423",
        "punchCount": 4,
        "coreComboId": "I11"
      },
      {
        "stage": 4,
        "tokens": [
          "1",
          "4",
          "2",
          "3",
          "6"
        ],
        "notation": "1-4-2-3-6",
        "compact": "14236",
        "punchCount": 5,
        "coreComboId": "I12"
      }
    ]
  },
  {
    "id": "IB03",
    "tier": "intermediate",
    "name": "Uppercut Cascade",
    "method": "Insert uppercuts between the straight entry and hook-cross finish.",
    "goal": "Move smoothly from long range into close-range work.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1",
          "2"
        ],
        "notation": "1-2",
        "compact": "12",
        "punchCount": 2,
        "coreComboId": "B01"
      },
      {
        "stage": 2,
        "tokens": [
          "1",
          "2",
          "5"
        ],
        "notation": "1-2-5",
        "compact": "125",
        "punchCount": 3,
        "coreComboId": null
      },
      {
        "stage": 3,
        "tokens": [
          "1",
          "2",
          "5",
          "6"
        ],
        "notation": "1-2-5-6",
        "compact": "1256",
        "punchCount": 4,
        "coreComboId": null
      },
      {
        "stage": 4,
        "tokens": [
          "1",
          "2",
          "5",
          "6",
          "3",
          "2"
        ],
        "notation": "1-2-5-6-3-2",
        "compact": "125632",
        "punchCount": 6,
        "coreComboId": "I08"
      }
    ]
  },
  {
    "id": "IB04",
    "tier": "intermediate",
    "name": "Body-Head Hook Double",
    "method": "Build a lead body hook into a same-hand head hook and rear-hand finish.",
    "goal": "Use one hand twice across two levels.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1",
          "2"
        ],
        "notation": "1-2",
        "compact": "12",
        "punchCount": 2,
        "coreComboId": "B01"
      },
      {
        "stage": 2,
        "tokens": [
          "1",
          "2",
          "3B"
        ],
        "notation": "1-2-3B",
        "compact": "123B",
        "punchCount": 3,
        "coreComboId": "B19"
      },
      {
        "stage": 3,
        "tokens": [
          "1",
          "2",
          "3B",
          "3"
        ],
        "notation": "1-2-3B-3",
        "compact": "123B3",
        "punchCount": 4,
        "coreComboId": null
      },
      {
        "stage": 4,
        "tokens": [
          "1",
          "2",
          "3B",
          "3",
          "2"
        ],
        "notation": "1-2-3B-3-2",
        "compact": "123B32",
        "punchCount": 5,
        "coreComboId": "I15"
      }
    ]
  },
  {
    "id": "IB05",
    "tier": "intermediate",
    "name": "Body Staircase",
    "method": "Start with body straights and progressively rise to hooks and uppercuts.",
    "goal": "Create a low-to-high attack shape.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1B",
          "2B"
        ],
        "notation": "1B-2B",
        "compact": "1B2B",
        "punchCount": 2,
        "coreComboId": null
      },
      {
        "stage": 2,
        "tokens": [
          "1B",
          "2B",
          "3"
        ],
        "notation": "1B-2B-3",
        "compact": "1B2B3",
        "punchCount": 3,
        "coreComboId": null
      },
      {
        "stage": 3,
        "tokens": [
          "1B",
          "2B",
          "3",
          "2"
        ],
        "notation": "1B-2B-3-2",
        "compact": "1B2B32",
        "punchCount": 4,
        "coreComboId": "I17"
      },
      {
        "stage": 4,
        "tokens": [
          "1B",
          "2B",
          "3",
          "6",
          "3",
          "2"
        ],
        "notation": "1B-2B-3-6-3-2",
        "compact": "1B2B3632",
        "punchCount": 6,
        "coreComboId": "A08"
      }
    ]
  },
  {
    "id": "IB06",
    "tier": "intermediate",
    "name": "Rear-Uppercut Line",
    "method": "Build from the jab-rear-uppercut entry into alternating pocket punches.",
    "goal": "Use the rear uppercut as a bridge rather than a terminal punch.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1",
          "6"
        ],
        "notation": "1-6",
        "compact": "16",
        "punchCount": 2,
        "coreComboId": "B09"
      },
      {
        "stage": 2,
        "tokens": [
          "1",
          "6",
          "3"
        ],
        "notation": "1-6-3",
        "compact": "163",
        "punchCount": 3,
        "coreComboId": "B12"
      },
      {
        "stage": 3,
        "tokens": [
          "1",
          "6",
          "3",
          "2"
        ],
        "notation": "1-6-3-2",
        "compact": "1632",
        "punchCount": 4,
        "coreComboId": null
      },
      {
        "stage": 4,
        "tokens": [
          "1",
          "6",
          "3",
          "2",
          "5",
          "2"
        ],
        "notation": "1-6-3-2-5-2",
        "compact": "163252",
        "punchCount": 6,
        "coreComboId": "A13"
      }
    ]
  },
  {
    "id": "AB01",
    "tier": "advanced",
    "name": "Extended Square Ladder",
    "method": "Preserve the exact 1-4-2-3 prefix and add one finishing layer at a time.",
    "goal": "Long-chain recall, hand-plane changes, and a decisive finish.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1",
          "4",
          "2",
          "3"
        ],
        "notation": "1-4-2-3",
        "compact": "1423",
        "punchCount": 4,
        "coreComboId": "I11"
      },
      {
        "stage": 2,
        "tokens": [
          "1",
          "4",
          "2",
          "3",
          "6"
        ],
        "notation": "1-4-2-3-6",
        "compact": "14236",
        "punchCount": 5,
        "coreComboId": "I12"
      },
      {
        "stage": 3,
        "tokens": [
          "1",
          "4",
          "2",
          "3",
          "6",
          "5"
        ],
        "notation": "1-4-2-3-6-5",
        "compact": "142365",
        "punchCount": 6,
        "coreComboId": "A01"
      },
      {
        "stage": 4,
        "tokens": [
          "1",
          "4",
          "2",
          "3",
          "6",
          "5",
          "2"
        ],
        "notation": "1-4-2-3-6-5-2",
        "compact": "1423652",
        "punchCount": 7,
        "coreComboId": "A02"
      },
      {
        "stage": 5,
        "tokens": [
          "1",
          "4",
          "2",
          "3",
          "6",
          "5",
          "3",
          "2"
        ],
        "notation": "1-4-2-3-6-5-3-2",
        "compact": "14236532",
        "punchCount": 8,
        "coreComboId": "A03"
      }
    ]
  },
  {
    "id": "AB02",
    "tier": "advanced",
    "name": "Body-Head Pressure Ladder",
    "method": "Use a double-jab entry, then grow a same-lead-hand body/head sequence.",
    "goal": "Maintain structure while adding same-hand level changes.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1",
          "1",
          "2"
        ],
        "notation": "1-1-2",
        "compact": "112",
        "punchCount": 3,
        "coreComboId": "B03"
      },
      {
        "stage": 2,
        "tokens": [
          "1",
          "1",
          "2",
          "3B"
        ],
        "notation": "1-1-2-3B",
        "compact": "1123B",
        "punchCount": 4,
        "coreComboId": null
      },
      {
        "stage": 3,
        "tokens": [
          "1",
          "1",
          "2",
          "3B",
          "3"
        ],
        "notation": "1-1-2-3B-3",
        "compact": "1123B3",
        "punchCount": 5,
        "coreComboId": null
      },
      {
        "stage": 4,
        "tokens": [
          "1",
          "1",
          "2",
          "3B",
          "3",
          "2"
        ],
        "notation": "1-1-2-3B-3-2",
        "compact": "1123B32",
        "punchCount": 6,
        "coreComboId": "A04"
      },
      {
        "stage": 5,
        "tokens": [
          "1",
          "1",
          "2",
          "3B",
          "3",
          "2",
          "5",
          "2"
        ],
        "notation": "1-1-2-3B-3-2-5-2",
        "compact": "1123B3252",
        "punchCount": 8,
        "coreComboId": "A05"
      }
    ]
  },
  {
    "id": "AB03",
    "tier": "advanced",
    "name": "Alternating Uppercut Ladder",
    "method": "Grow an uppercut pair into two hook-cross finishing motifs.",
    "goal": "Extended alternating-hand rhythm at close range.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1",
          "2",
          "5",
          "6"
        ],
        "notation": "1-2-5-6",
        "compact": "1256",
        "punchCount": 4,
        "coreComboId": null
      },
      {
        "stage": 2,
        "tokens": [
          "1",
          "2",
          "5",
          "6",
          "3"
        ],
        "notation": "1-2-5-6-3",
        "compact": "12563",
        "punchCount": 5,
        "coreComboId": null
      },
      {
        "stage": 3,
        "tokens": [
          "1",
          "2",
          "5",
          "6",
          "3",
          "2"
        ],
        "notation": "1-2-5-6-3-2",
        "compact": "125632",
        "punchCount": 6,
        "coreComboId": "I08"
      },
      {
        "stage": 4,
        "tokens": [
          "1",
          "2",
          "5",
          "6",
          "3",
          "2",
          "3",
          "2"
        ],
        "notation": "1-2-5-6-3-2-3-2",
        "compact": "12563232",
        "punchCount": 8,
        "coreComboId": "A12"
      }
    ]
  },
  {
    "id": "AB04",
    "tier": "advanced",
    "name": "Rolling Pressure Chain",
    "method": "Extend a 1-2-3 with a rear uppercut and repeating hook-cross pressure.",
    "goal": "Create a repeating, memorable pressure motif.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1",
          "2",
          "3"
        ],
        "notation": "1-2-3",
        "compact": "123",
        "punchCount": 3,
        "coreComboId": "B10"
      },
      {
        "stage": 2,
        "tokens": [
          "1",
          "2",
          "3",
          "6"
        ],
        "notation": "1-2-3-6",
        "compact": "1236",
        "punchCount": 4,
        "coreComboId": null
      },
      {
        "stage": 3,
        "tokens": [
          "1",
          "2",
          "3",
          "6",
          "3"
        ],
        "notation": "1-2-3-6-3",
        "compact": "12363",
        "punchCount": 5,
        "coreComboId": "I09"
      },
      {
        "stage": 4,
        "tokens": [
          "1",
          "2",
          "3",
          "6",
          "3",
          "2"
        ],
        "notation": "1-2-3-6-3-2",
        "compact": "123632",
        "punchCount": 6,
        "coreComboId": null
      },
      {
        "stage": 5,
        "tokens": [
          "1",
          "2",
          "3",
          "6",
          "3",
          "2",
          "3",
          "2"
        ],
        "notation": "1-2-3-6-3-2-3-2",
        "compact": "12363232",
        "punchCount": 8,
        "coreComboId": "A11"
      }
    ]
  },
  {
    "id": "AB05",
    "tier": "advanced",
    "name": "Body-to-Head Staircase",
    "method": "Begin with two body straights and add head punches in rising planes.",
    "goal": "Train level changes without randomizing the core pattern.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1B",
          "2B"
        ],
        "notation": "1B-2B",
        "compact": "1B2B",
        "punchCount": 2,
        "coreComboId": null
      },
      {
        "stage": 2,
        "tokens": [
          "1B",
          "2B",
          "3"
        ],
        "notation": "1B-2B-3",
        "compact": "1B2B3",
        "punchCount": 3,
        "coreComboId": null
      },
      {
        "stage": 3,
        "tokens": [
          "1B",
          "2B",
          "3",
          "6"
        ],
        "notation": "1B-2B-3-6",
        "compact": "1B2B36",
        "punchCount": 4,
        "coreComboId": null
      },
      {
        "stage": 4,
        "tokens": [
          "1B",
          "2B",
          "3",
          "6",
          "3",
          "2"
        ],
        "notation": "1B-2B-3-6-3-2",
        "compact": "1B2B3632",
        "punchCount": 6,
        "coreComboId": "A08"
      }
    ]
  },
  {
    "id": "AB06",
    "tier": "advanced",
    "name": "Split-Level Wave",
    "method": "Place body attacks in separate phases rather than clustering them.",
    "goal": "Create two distinct body threats inside one long combination.",
    "stages": [
      {
        "stage": 1,
        "tokens": [
          "1",
          "2B",
          "3"
        ],
        "notation": "1-2B-3",
        "compact": "12B3",
        "punchCount": 3,
        "coreComboId": null
      },
      {
        "stage": 2,
        "tokens": [
          "1",
          "2B",
          "3",
          "2"
        ],
        "notation": "1-2B-3-2",
        "compact": "12B32",
        "punchCount": 4,
        "coreComboId": "I14"
      },
      {
        "stage": 3,
        "tokens": [
          "1",
          "2B",
          "3",
          "2",
          "5B"
        ],
        "notation": "1-2B-3-2-5B",
        "compact": "12B325B",
        "punchCount": 5,
        "coreComboId": null
      },
      {
        "stage": 4,
        "tokens": [
          "1",
          "2B",
          "3",
          "2",
          "5B",
          "2"
        ],
        "notation": "1-2B-3-2-5B-2",
        "compact": "12B325B2",
        "punchCount": 6,
        "coreComboId": "A18"
      }
    ]
  }
] as const satisfies readonly BuildUpSet[];

export const OPTIONAL_FOOTWORK_WRAPPERS = [
  {
    "id": "FW01",
    "label": "Step in",
    "placement": "before",
    "minimumTier": "beginner",
    "command": "STEP_IN",
    "use": "Close distance before a jab-led combination."
  },
  {
    "id": "FW02",
    "label": "Reset",
    "placement": "after",
    "minimumTier": "beginner",
    "command": "RESET",
    "use": "Return to balanced stance after any exact combination."
  },
  {
    "id": "FW03",
    "label": "Lead pivot",
    "placement": "after",
    "minimumTier": "intermediate",
    "command": "PIVOT_LEAD",
    "use": "Change angle after a rear-hand or lead-hook finish."
  },
  {
    "id": "FW04",
    "label": "Step off",
    "placement": "after",
    "minimumTier": "intermediate",
    "command": "STEP_OFF",
    "use": "Exit the centerline after a power finish."
  },
  {
    "id": "FW05",
    "label": "Angle between phases",
    "placement": "between-spoken-groups",
    "minimumTier": "advanced",
    "command": "ANGLE",
    "use": "Split a long chain into attack, angle change, and second attack."
  },
  {
    "id": "FW06",
    "label": "Circle and re-enter",
    "placement": "between-repetitions",
    "minimumTier": "advanced",
    "command": "CIRCLE",
    "use": "Add recovery movement without changing the scored punch sequence."
  }
] as const;

export const GENERATOR_RULES = [
  {
    "id": "GR01",
    "name": "Jab-heavy distribution",
    "rule": "At least 75% of generated exact combinations should begin with 1, 1B, or 1-1; this seed corpus is more jab-heavy than that floor."
  },
  {
    "id": "GR02",
    "name": "Tiered length",
    "rule": "Beginner exact combinations use 2-4 punches, intermediate 3-6, and advanced 6-9. Longer output belongs in timed flurries rather than endlessly voiced strings."
  },
  {
    "id": "GR03",
    "name": "Curated transitions",
    "rule": "Generate from approved templates and transformations; do not select punch numbers independently at random."
  },
  {
    "id": "GR04",
    "name": "Same-hand cost",
    "rule": "Double jabs are broadly allowed. Consecutive same-hand hooks, uppercuts, or rear-hand reloads require intermediate or advanced tagging and a compatible range."
  },
  {
    "id": "GR05",
    "name": "Level-change budget",
    "rule": "Beginner combinations use no more than one body-shot token; intermediate normally use no more than two; advanced may use more when the sequence remains balanced."
  },
  {
    "id": "GR06",
    "name": "Power finish",
    "rule": "Prefer a rear cross, lead hook, rear hook, or uppercut as the final strike; jab endings are useful for reset drills but should be a minority."
  },
  {
    "id": "GR07",
    "name": "Phase grouping",
    "rule": "Combinations longer than four punches should carry spokenGroups metadata so the coach voice can call memorable motifs instead of a flat digit stream."
  },
  {
    "id": "GR08",
    "name": "Angle after work",
    "rule": "Intermediate and advanced workouts should optionally append a reset, pivot, or step-off after the punch string; footwork remains instructional unless separately tracked."
  },
  {
    "id": "GR09",
    "name": "Long-chain labeling",
    "rule": "Seven-to-nine-punch strings are heavy-bag memory and conditioning chains, not claims about an uninterrupted exchange in live competition."
  },
  {
    "id": "GR10",
    "name": "Stance-relative semantics",
    "rule": "Odd numbers always mean lead hand and even numbers rear hand. Never convert the corpus to fixed left/right semantics when the user switches stance."
  }
] as const;

export const COMBOS_BY_ID: Readonly<Record<string, ComboDefinition>> =
  Object.fromEntries(COMBO_CORPUS.map(combo => [combo.id, combo]));

export function getCombosByTier(tier: ComboTier): readonly ComboDefinition[] {
  return COMBO_CORPUS.filter(combo => combo.tier === tier);
}

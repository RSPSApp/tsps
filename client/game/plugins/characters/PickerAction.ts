export type PickerAction =
    | { type: "select_character"; index: number }
    | { type: "play_character" }
    | { type: "new_character" }
    | { type: "delete_character" }
    | { type: "submit_picker_input" }
    | { type: "cancel_picker_input" }
    | { type: "sign_out_picker" };

export const PickerActions = {
    PLAY_CHARACTER: { type: "play_character" } as const,
    NEW_CHARACTER: { type: "new_character" } as const,
    DELETE_CHARACTER: { type: "delete_character" } as const,
    SUBMIT_PICKER_INPUT: { type: "submit_picker_input" } as const,
    CANCEL_PICKER_INPUT: { type: "cancel_picker_input" } as const,
    SIGN_OUT_PICKER: { type: "sign_out_picker" } as const,
} as const;

export interface EnteredAmountAction {
    acceptsZero?: boolean;
    acceptsNegative?: boolean;
    execute(amount: number): void;
}

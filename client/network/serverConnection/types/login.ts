/** Optional client behavior negotiated on each connection before login. */
export interface LoginProtocolExtension {
    resetConnection(): void;
    loginAttempt(): void;
    loginFlags(flags: number): number;
    handleMessage(message: any): boolean;
}

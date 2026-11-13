export declare const FABRICATED_SB_SECRET: string;
export declare const FABRICATED_JWT_MARKER: string;
export declare function isFabricatedJwt(jwt: string): boolean;
export declare function scanTextForSecretKeys(text: string): string[];
export declare function validateClientKey(key: string): void;

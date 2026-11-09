import type { Policy } from './classify.mjs';

export function createProxy(policy: Policy): (request: Request) => Response;

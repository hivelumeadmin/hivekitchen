export interface LumiAgentRespondInput {
  message: string;
}

// Stub for Story 12-S8. Real LLM dispatch with surface prompts + household
// snapshot lands in Story 12-S9. Constructor takes no args so S9 can add
// dependency injection without changing the service call-site structure.
export class LumiAgent {
  // `input` is part of the S9-facing contract (the service already passes the
  // user message); the stub ignores it and returns a fixed acknowledgement.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  respond(input: LumiAgentRespondInput): Promise<string> {
    return Promise.resolve('Got it.');
  }
}

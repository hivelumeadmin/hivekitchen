# Voice Interaction Design
## HiveLume Backend — Feature Design Document

**Status:** Final Draft  
**Version:** 1.1  
**Feature Area:** Voice  
**Module:** `voice/`  
**Author:** HiveLume Engineering  
**Last Updated:** 2026-04-13  
**Changelog:** 

---

## 1. Overview

This document defines the backend design for Lumi Voice — the spoken interface to the Lumi kitchen companion. It covers the integration boundary with ElevenLabs, token provisioning, webhook handling, intent deduction, resource creation behaviour, session lifecycle, transcript management, SSE events, and error handling.

The companion product document, `LUMI_VOICE_HLD.md`, describes the philosophy and workflow from a user experience perspective. This document describes how the system is built to deliver that experience.

---

## 2. Scope

This document covers the following:

- Token provisioning via `POST /v1/voice/token`
- ElevenLabs Conversational AI SDK integration model
- Webhook from ElevenLabs to the HiveKitchen backend
- Intent deduction and agent orchestration within HiveKitchen
- Resource creation behaviour — auto-save, no confirmation gate
- Session lifecycle — open, active, close, and unexpected disconnection
- Transcript storage and SSE delivery
- UI refresh events via SSE
- Modality switching between voice and text
- Audit events
- Hard constraints and explicit out-of-scope items

---

## 3. Architecture Overview


┌─────────────────────────────────────────────────────────────────┐
│ Web Client 													  │
│    															  │
│ ┌──────────────┐    ┌─────────────────┐ ┌───────────────┐ 	  │
│ │ Voice UI     │    │ ElevenLabs SDK  │ │ Chat Window   │       │
│ │ (overlay)    │◄──►│ (WebSocket)     │ │ (transcript)  │       │
│ └───────┬──────┘    └────────┬────────┘ └───────────────┘       │
│         │                    │                  ▲               │
└─────────┼────────────────────┼──────────────────┼───────────────┘
          │                    │                  │
            POST /v1/voice/    │ WebSocket        │ SSE
          │ token              │ (audio, TTS)     │ (transcript,
          │                    │                  │ ui events)
          ▼                    ▼                  │  
┌─────────────────┐ ┌─────────────────┐ ┌─────────┸──────────┐
│ HiveKitchen     │ │ ElevenLabs      │ │ HiveKitchen        │
│ Auth + Token    │ │ Platform        │ │ SSE Channel        │
│ Service         │ │                 │ │                    │
└────────┬────────┘ └────────┬────────┘ └────────────────────┘
         │                   │
         │                   │ POST (webhook)
         │                   │ transcript text + session context
         │                   ▼
         │           ┌─────────────────────────────────────────────┐
         └──────────►│ HiveKitchen Backend                         │
                     │                                             │
                     │ ┌──────────────────────────────────────┐    │
                     │ │ Agent Orchestrator                   │    │
                     │ │                                      │    │
                     │ │ 1. Load thread + user context        │    │
                     │ │ 2. Deduce intent from transcript     │    │
                     │ │ 3. Route to specialist agent 		  │    │
                     │ │ 4. Call tools as needed 			  │    │ 
                     │ │ 5. Execute + persist resource        │    │
                     │ │ 6. Compose spoken-language response  │    │
                     │ └──────────────────────────────────────┘    │
                     │                                             │
                     └─────────────────────────────────────────────┘


ElevenLabs is the voice infrastructure layer. It owns audio capture, speech-to-text, turn management, natural language expression enrichment, and text-to-speech synthesis. It has no knowledge of cooking, user preferences, or application state.

HiveKitchen is the intelligence layer. It owns intent deduction, context management, tool orchestration, resource persistence, and response composition. It has no knowledge of audio or voice synthesis.

The two systems communicate in one direction per turn: ElevenLabs calls HiveKitchen via webhook with a sanitised transcript text. HiveKitchen returns a plain text response. That response is enriched and synthesised by ElevenLabs before being delivered to the client.

---

## 4. ElevenLabs Integration Model

### 4.1 SDK and Transport

The client uses the ElevenLabs Conversational AI SDK. The SDK manages the WebSocket connection, handles audio capture and streaming to ElevenLabs, receives synthesised TTS audio from ElevenLabs, manages silence detection and turn-end inference, and exposes session lifecycle events to the client application.

The HiveKitchen backend does not directly manage a WebSocket connection to ElevenLabs. The backend's integration surface is entirely through two points: the token provisioning endpoint and the inbound webhook.

### 4.2 Non-Streaming TTS

ElevenLabs synthesises and delivers TTS audio as a complete, non-streaming response. The client receives the full audio for a turn and plays it in its entirety before the next turn begins. Streaming audio delivery is not used.

This choice aligns with the turn-based nature of voice cooking assistance. Users ask a question, hear a complete answer, and then speak again. There is no scenario where the user benefits from hearing a partial sentence while the rest is still being synthesised. Non-streaming simplifies the client audio pipeline and removes the complexity of mid-stream interruption handling.

### 4.3 Turn Management

Turn boundaries — detecting when the user has finished speaking — are managed entirely by ElevenLabs using its built-in silence detection and end-of-turn inference. The client does not signal the HiveKitchen backend when a turn ends. The HiveKitchen backend does not listen for any client event related to turn completion. The backend is called by ElevenLabs when a complete turn transcript is ready, not when the client reports anything.

This keeps the backend turn-handling simple and stateless with respect to audio rhythm. The backend receives a webhook call, processes it, and returns a response. It has no awareness of real-time audio state.

### 4.4 ElevenLabs Agent Configuration

A Lumi Voice agent is configured within the ElevenLabs platform. The agent is configured to:

- Call the HiveKitchen webhook endpoint for every user turn
- Pass the full sanitised transcript text of the turn
- Pass the session context, including the `threadId` and `userId`
- Return HiveKitchen's text response to ElevenLabs for expression enrichment and TTS synthesis
- Use Lumi's designated voice identity within ElevenLabs

The agent does not perform any intent classification, routing, or application logic. Its sole function is to relay the transcript to HiveKitchen and relay HiveKitchen's response to the synthesis pipeline.

---

## 5. Token Provisioning

### 5.1 Trigger

A token is requested **only** when the user actively opens the voice interface by tapping the Lumi Voice button. Tokens are never pre-fetched, cached from a prior session, or requested proactively at app launch or login. The request is always synchronous with the user action.

### 5.2 Endpoint


POST /v1/voice/token
Authorization: Bearer <user_jwt>


### 5.3 Token Contents and Scope
The token is issued by HiveKitchen and provisioned through the ElevenLabs token API. It encodes the following into the ElevenLabs session:

The userId of the authenticated user
The threadId of the user's current or most recent conversation thread
A reference to the Lumi Voice agent configuration
The token is short-lived. Its expiry is set to a value sufficient to cover a typical voice cooking session. If a token expires mid-session, ElevenLabs will disconnect the WebSocket, and the client handles this as a session close event. The user must tap to open a new session, which will issue a fresh token.

### 5.4 Session Record
When a token is issued, HiveKitchen creates a voice session record in its session store. This record holds the session_id, user_id, thread_id, creation timestamp, and status (active). The session record is the authoritative record of an open voice session and is used during cleanup on session close.

## 6. Inbound Webhook — ElevenLabs to HiveKitchen
### 6.1 Endpoint
POST /v1/voice/webhook/elevenlabs

This endpoint is not authenticated with a user JWT. It is secured via a shared webhook secret that ElevenLabs includes in a request header, validated by HiveKitchen on every call.

### 6.2 Request Shape
json
{
  "session_id": "<uuid>",
  "user_id": "<uuid>",
  "thread_id": "<uuid>",
  "turn_id": "<uuid>",
  "transcript": "What can I make with the chicken in my fridge?",
  "timestamp": "<iso8601_timestamp>"
}

The transcript field contains the sanitised, plain-text user utterance for this turn. It contains no audio data.

### 6.3 Response Shape
HiveKitchen returns a plain text response in the HTTP response body. The response is a complete spoken-language string with no markdown, no bullet points, no numbered lists, and no structural formatting. It is written as a knowledgeable friend would speak it.

json
{
  "response": "You've got two chicken breasts and some wilting spinach — 
                I'd go for a quick garlic butter chicken with the spinach 
                wilted in. Takes about twenty minutes. Want me to walk you 
                through it or save it as tonight's plan?"
}

If HiveKitchen performed an action (e.g. saved a meal plan), the spoken response includes a natural confirmation of that action.

### 6.4 Response Timing
HiveKitchen must return a response within ElevenLabs' webhook timeout window. If tool calls are required that may approach this limit, the agent should return an intermediate acknowledgement response ("Let me pull up your fridge inventory...") and handle extended processing asynchronously where the ElevenLabs platform supports continuation. The specifics of multi-turn tool call sequencing under latency pressure are addressed in the agent orchestration design.

## 7. Resource Creation and Persistence

### 7.1 Post-Save Editing 
If a user wants to modify a resource that Lumi has created — a meal plan, for instance — they have two paths:

Path 1 — Continue the conversation. The user can speak a follow-up request in the same voice session or in a subsequent text session: "actually, make Tuesday vegetarian." The agent will load the existing plan, apply the modification, persist the updated plan, and confirm the change verbally. The same auto-save behaviour applies — the update is saved immediately.

Path 2 — Edit in the UI. The user can navigate to the resource in the app and edit it directly through the standard UI editing controls. Tap to open a plan, tap to change a meal, swipe to remove a day. No voice session is required and no backend agent is involved in UI-level edits unless the user chooses to make them through voice.

Both paths are first-class. The voice session is for creating and exploring. The UI is the editing surface.

## 8. Session Lifecycle

### 8.1 Session Open
User taps the Lumi Voice button.
Client calls POST /v1/voice/token.
HiveKitchen validates the user JWT, creates a session record (status: active), provisions an ElevenLabs token, and returns the token response.
Client initialises the ElevenLabs SDK with the token.
WebSocket connection to ElevenLabs is established.
ElevenLabs plays Lumi's session opening line.
Session is live. HiveKitchen emits voice.session.started audit event.

## 8.2 Active Session
The session remains active for the duration of the ElevenLabs WebSocket connection. Each user turn triggers an ElevenLabs-to-HiveKitchen webhook call (Section 6). The session record is updated with the timestamp of the most recent turn.

## 8.3 Graceful Session Close
User taps the end session button or closes the voice overlay.
Client signals the ElevenLabs SDK to close the WebSocket connection.
ElevenLabs sends a session-end event to HiveKitchen via webhook.
HiveKitchen updates the session record to status: closed, records the end timestamp, and writes the voice.session.ended audit event.
Client voice UI closes. The chat window (if the user navigates to it) reflects the full thread including the session's turns.

## 8.4 Unexpected Disconnection
If the WebSocket is lost due to network failure, app backgrounding, or device interruption:

ElevenLabs detects the disconnection and sends a session-end webhook to HiveKitchen.
HiveKitchen updates the session record to status: disconnected and writes the voice.session.disconnected audit event.
Any turn that was in-flight at the time of disconnection is discarded. If the agent had already persisted a resource for that turn, the resource remains. If the agent had not yet persisted, no partial state is written.
The session TTL in the session store handles expiry of any session record that did not receive a clean close event.
When the user next opens the voice interface, a new session and a new token are issued. The thread context is unchanged.

### 9. Transcript Management
## 9.1 Storage
Every turn in a voice session is stored in the thread, exactly as text turns are stored. The turn record includes the user's spoken message (sourced from the ElevenLabs-provided transcript), the agent's response text, the turn timestamp, and a modality: voice flag. This flag is used by the client to display a microphone icon next to voice turns in the chat window.

## 9.2 Opt-In Visibility
The chat transcript is hidden by default within the voice session overlay. The voice UI surfaces the session controls — the active indicator, the speaking animation, and the end session button — without the conversation text beneath it.

If the user wants to read what was said, they tap once to expand the transcript panel within the voice overlay. The panel shows all turns from the current session in chronological order. Tapping again collapses it.

### 9.3 Post-Session Access
When the voice session is closed and the user navigates to the standard chat interface, the full thread is visible there. Voice turns and text turns appear in a single unified timeline. Voice turns are identified by the microphone icon on the user's message bubble. The user can scroll, read, and continue the conversation in text from exactly where the voice session left off.


## 10. Modality Switching
Voice and text share a single thread. The thread_id is the same regardless of whether the user is speaking or typing. Switching modalities does not create a new thread, reset context, or require the user to re-establish state.

When a user opens a voice session after typing, the thread_id from their active text conversation is passed to POST /v1/voice/token and embedded in the ElevenLabs session. The agent loads the full thread history on the first webhook call and responds with full awareness of prior text turns.

When a user closes a voice session and returns to the text interface, the chat window shows the complete thread — text and voice turns together — and the user can type their next message without any re-orientation step.

## 11. Out-of-Scope
The following items are explicitly out of scope for this feature and should not be implemented as part of the voice module:

-Wake word activation. There is no ambient listening. The voice session is always and only initiated by user tap.
-Client turn-end signalling. The client does not notify the HiveKitchen backend when a user finishes speaking. Turn management is handled entirely by ElevenLabs.
-Confirmation cards or gates. No resource creation action requires a confirmation step from the user. The spoken request is sufficient.
-Out-of-scope query handling. Queries outside cooking, nutrition, and the user's kitchen data are not handled. The agent redirects gracefully.
-OS-level integrations. Lumi Voice does not set device timers, interface with the OS assistant layer, or interact with other applications.
-Multi-user session sharing. A voice session is always scoped to a single authenticated user.
## 12. Audit Events
The following audit events are written to the audit log by the voice module:

Event	Written When
voice.token.issued	Token provisioned successfully via POST /v1/voice/token
voice.token.failed	Token provisioning failed (ElevenLabs unavailable, auth error)
voice.session.started	Session record created
voice.session.ended	Clean session close received from ElevenLabs
voice.session.disconnected	Unexpected disconnection detected
voice.turn.received	Webhook called with a turn transcript
voice.turn.completed	Turn processed and response returned to ElevenLabs
voice.turn.failed	Turn processing failed; error response returned
voice.resource.created	A resource was auto-saved as part of a voice turn
voice.resource.updated	An existing resource was modified as part of a voice turn

## 13. Error Handling
### Token Provisioning Failures
If POST /v1/voice/token fails because ElevenLabs is unavailable, HiveKitchen returns 503 and the client displays a non-blocking inline error in the voice UI. The user can retry by tapping the button again.

If the user's JWT is invalid, HiveKitchen returns 401 and the client handles this through its standard re-authentication flow.

### Webhook Processing Failures
If the agent orchestrator encounters an unrecoverable error while processing a turn, HiveKitchen returns an HTTP error response to ElevenLabs. ElevenLabs handles this as a failed turn. The agent should attempt to return a graceful spoken error response where possible ("Sorry, I hit a problem there — could you try again?") rather than a raw HTTP error, so ElevenLabs can synthesise it and the user is not left in silence.

A voice.turn.failed audit event is written for all failed turns, including the error type and any available context.

### Mid-Session Resource Persistence Failures
If a resource persistence operation fails after the agent has already composed its spoken response (a race that should be avoided by ordering persistence before response composition), HiveKitchen must not return a response that tells the user the resource was saved. The agent should return a response indicating the action could not be completed and that the user should try again. The voice.resource.created audit event is only written on successful persistence.
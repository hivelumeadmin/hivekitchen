// @file: apps/api/src/plugins/elevenlabs.ts
// Vendor SDK import inside plugins/ — lint must pass.
import { ElevenLabs } from '@elevenlabs/elevenlabs-js';
import { createClient } from '@supabase/supabase-js';

export const elevenLabs = ElevenLabs;
export const supabase = createClient;

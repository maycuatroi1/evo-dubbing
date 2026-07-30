export interface ManagedVoiceProfile {
  id: string;
  version: string;
}

export const MANAGED_VOICE_PROFILES: ManagedVoiceProfile[] = [
  { id: "vi-standard-female", version: "vi-VN.kore.2026-07-25" },
  { id: "vi-economy-female", version: "vi-VN.wavenet-a.2026-07-25" }
];

export const DEFAULT_MANAGED_VOICE_PROFILE_ID = "vi-standard-female";

export const MANAGED_GENERATION_PROFILE = "managed.gen.v1";

export function getManagedVoiceProfile(id: string): ManagedVoiceProfile {
  return (
    MANAGED_VOICE_PROFILES.find((p) => p.id === id) ??
    MANAGED_VOICE_PROFILES.find((p) => p.id === DEFAULT_MANAGED_VOICE_PROFILE_ID)!
  );
}

export function managedTtsNamespace(profileId: string): string {
  const profile = getManagedVoiceProfile(profileId);
  return `managed:tts:${profile.id}@${profile.version}`;
}

export const MANAGED_TRANSLATE_NAMESPACE = "managed:translate:v1";

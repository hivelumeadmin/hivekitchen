import { SparkleIcon } from '@hivekitchen/ui';
import type { InterviewTurn, MessagePart } from '../data/mockData.js';
import { InterviewMessage } from './InterviewMessage.js';

interface Readonly_ChatThreadProps {
  readonly turns: readonly InterviewTurn[];
  readonly userAvatarSrc: string;
  readonly userAvatarAlt: string;
}

export type ChatThreadProps = Readonly<Readonly_ChatThreadProps>;

export function ChatThread({ turns, userAvatarSrc, userAvatarAlt }: ChatThreadProps) {
  return (
    <div className="relative z-10 flex flex-col gap-8 before:absolute before:bottom-0 before:left-6 before:top-10 before:z-0 before:w-px before:bg-border">
      {turns.map((turn, i) => {
        if (turn.kind === 'listening') {
          return <LumiListeningTurn key={i} timestamp={turn.timestamp} />;
        }
        if (turn.speaker === 'lumi') {
          return (
            <LumiTurn key={i} timestamp={turn.timestamp} message={turn.message} />
          );
        }
        return (
          <UserTurn
            key={i}
            timestamp={turn.timestamp}
            message={turn.message}
            avatarSrc={userAvatarSrc}
            avatarAlt={userAvatarAlt}
          />
        );
      })}
    </div>
  );
}

function LumiTurn({
  timestamp,
  message,
}: Readonly<{ readonly timestamp: string; readonly message: readonly MessagePart[] }>) {
  return (
    <div className="flex w-full gap-4">
      <LumiAvatar />
      <TurnBody name="Lumi" timestamp={timestamp}>
        <div className="border-l-2 border-lumi-terracotta py-1 ps-4">
          <InterviewMessage parts={message} variant="serif" />
        </div>
      </TurnBody>
    </div>
  );
}

function UserTurn({
  timestamp,
  message,
  avatarSrc,
  avatarAlt,
}: Readonly<{
  readonly timestamp: string;
  readonly message: readonly MessagePart[];
  readonly avatarSrc: string;
  readonly avatarAlt: string;
}>) {
  return (
    <div className="flex w-full gap-4">
      <UserAvatar src={avatarSrc} alt={avatarAlt} />
      <TurnBody name="You" timestamp={timestamp}>
        <div className="border-l-2 border-border py-1 ps-4">
          <div className="inline-block rounded-xl border border-border bg-surface-2 p-4">
            <InterviewMessage parts={message} variant="sans" />
          </div>
        </div>
      </TurnBody>
    </div>
  );
}

function LumiListeningTurn({ timestamp }: Readonly<{ readonly timestamp: string }>) {
  return (
    <div className="mt-4 flex w-full gap-4 opacity-80">
      <LumiListeningAvatar />
      <TurnBody name="Lumi" timestamp={timestamp}>
        <div className="flex h-8 items-center border-l-2 border-border py-1 ps-4">
          <div className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-border [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-border [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-border [animation-delay:300ms]" />
          </div>
        </div>
      </TurnBody>
    </div>
  );
}

function TurnBody({
  name,
  timestamp,
  children,
}: Readonly<{
  readonly name: string;
  readonly timestamp: string;
  readonly children: React.ReactNode;
}>) {
  return (
    <div className="flex w-full flex-col gap-1 pt-2">
      <div className="flex items-baseline gap-3">
        <span className="text-xs text-fg-muted">{name}</span>
        <span className="text-xs text-fg-muted/70">{timestamp}</span>
      </div>
      {children}
    </div>
  );
}

function LumiAvatar() {
  return (
    <div className="relative z-10 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border border-border bg-surface">
      <SparkleIcon className="h-5 w-5 text-lumi-terracotta" />
    </div>
  );
}

function LumiListeningAvatar() {
  return (
    <div className="relative z-10 flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-surface">
      <span className="h-2 w-2 animate-pulse rounded-full bg-sacred" />
    </div>
  );
}

function UserAvatar({ src, alt }: Readonly<{ readonly src: string; readonly alt: string }>) {
  return (
    <div className="relative z-10 h-12 w-12 flex-shrink-0 overflow-hidden rounded-full border border-border bg-surface">
      <img src={src} alt={alt} className="h-full w-full object-cover" />
    </div>
  );
}

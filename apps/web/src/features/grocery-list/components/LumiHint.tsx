import { ForumIcon } from '../../../components/icons.js';

interface Readonly_LumiHintProps {
  readonly text: string;
}

export type LumiHintProps = Readonly<Readonly_LumiHintProps>;

export function LumiHint({ text }: LumiHintProps) {
  return (
    <div className="mb-3 flex items-center gap-2 px-2 text-lumi-terracotta">
      <ForumIcon className="h-4 w-4" />
      <span className="text-xs italic">Lumi: “{text}”</span>
    </div>
  );
}

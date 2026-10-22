import type { LucideIcon } from 'lucide-react';
import {
  Brain,
  Compass,
  Crown,
  Eye,
  Flame,
  Heart,
  Lightbulb,
  Palette,
  Rocket,
  Scale,
  Shield,
  Sparkles,
  Target,
  Wrench,
  Zap,
  Users,
} from 'lucide-react';
import type { MbtiType } from '@/lib/ai-fortune/mbti';

const MBTI_ICON_MAP: Record<MbtiType, LucideIcon> = {
  INTJ: Brain,
  INTP: Lightbulb,
  ENTJ: Crown,
  ENTP: Zap,
  INFJ: Eye,
  INFP: Heart,
  ENFJ: Users,
  ENFP: Sparkles,
  ISTJ: Shield,
  ISFJ: Scale,
  ESTJ: Target,
  ESFJ: Compass,
  ISTP: Wrench,
  ISFP: Palette,
  ESTP: Flame,
  ESFP: Rocket,
};

export function MbtiTypeIcon({ type, className }: { type: MbtiType; className?: string }) {
  const Icon = MBTI_ICON_MAP[type];
  return <Icon className={className} aria-hidden />;
}

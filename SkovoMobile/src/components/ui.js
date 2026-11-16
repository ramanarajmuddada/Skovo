// ── Reusable UI primitives ───────────────────────────────────────────────────
// Every screen renders through these, so a change here moves the whole app.
//
// Motion uses React Native's own Animated with `useNativeDriver`, not a new
// dependency: transform and opacity run on the UI thread, so a mid-range
// Android keeps 60fps while the JS thread is busy parsing an API response —
// which is exactly when these animations play.
import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, ActivityIndicator,
  ScrollView, RefreshControl, Animated, Easing, Pressable,
  Modal as RNModal, Alert, KeyboardAvoidingView, Platform, FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font, motion, tint, tap, darkColors, ACCENTS } from '../theme';

function useUi() {
  const { colors, shadow, gradients } = useTheme();
  const s = useThemedStyles(makeUiStyles);
  return { colors, shadow, gradients, s };
}

/* ── Motion helpers ───────────────────────────────────────────────────────── */

/** Fade + rise on mount. `index` staggers a list without touching each child. */
export function FadeIn({ children, index = 0, style, distance = 10 }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const delay = Math.min(index, motion.staggerCap) * motion.stagger;
    Animated.timing(t, {
      toValue: 1, duration: motion.slow, delay,
      easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: true,
    }).start();
  }, [t, index]);
  return (
    <Animated.View style={[style, {
      opacity: t,
      transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [distance, 0] }) }],
    }]}>
      {children}
    </Animated.View>
  );
}

/** Anything tappable scales down a touch. It is the cheapest way to make a UI
 *  feel responsive — the surface answers before the network does. */
function Pressable3D({ children, onPress, disabled, style, scaleTo = motion.press, accessibilityLabel }) {
  const scale = useRef(new Animated.Value(1)).current;
  const to = (v) => Animated.spring(scale, {
    toValue: v, useNativeDriver: true, speed: 40, bounciness: 4,
  }).start();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      onPressIn={() => !disabled && to(scaleTo)}
      onPressOut={() => to(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/* ── Screen ───────────────────────────────────────────────────────────────── */
export function Screen({ children, style, scroll, refreshing, onRefresh, contentStyle }) {
  const { colors, s } = useUi();
  const body = scroll ? (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[{ padding: spacing(5), paddingBottom: spacing(22) }, contentStyle]}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.primary} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1, padding: spacing(5) }, contentStyle]}>{children}</View>
  );
  return <SafeAreaView edges={['top']} style={[{ flex: 1, backgroundColor: colors.bg }, style]}>{body}</SafeAreaView>;
}

/* ── Type ─────────────────────────────────────────────────────────────────── */
export function H1({ children, style, color }) {
  const { s } = useUi();
  return <Text style={[s.h1, color && { color }, style]}>{children}</Text>;
}
export function H2({ children, style, color }) {
  const { s } = useUi();
  return <Text style={[s.h2, color && { color }, style]}>{children}</Text>;
}
export function Body({ children, style, color, muted }) {
  const { colors, s } = useUi();
  return <Text style={[s.body, muted && { color: colors.textMuted }, color && { color }, style]}>{children}</Text>;
}
export function Muted({ children, style, ...rest }) {
  const { s } = useUi();
  return <Text style={[s.muted, style]} {...rest}>{children}</Text>;
}

/* ── Card ─────────────────────────────────────────────────────────────────── */
// `flat` drops the shadow for cards sitting inside another card; `lifted` is
// for the one thing on screen that should feel closest to the reader.
export function Card({ children, style, onPress, flat, lifted, index }) {
  const { shadow, s } = useUi();
  const base = [s.card, flat && s.cardFlat, lifted && shadow.lifted, style];
  const inner = onPress
    ? <Pressable3D onPress={onPress} style={base}>{children}</Pressable3D>
    : <View style={base}>{children}</View>;
  return index === undefined ? inner : <FadeIn index={index}>{inner}</FadeIn>;
}

/* ── Button ───────────────────────────────────────────────────────────────── */
// variants: primary | outline | ghost | danger | soft | inverse
//           (`secondary` is accepted as an alias of outline)
// sizes: md | sm | lg
export function Button({
  title, onPress, loading, disabled, variant = 'primary', size = 'md',
  icon, iconRight, accent, style, full,
}) {
  const { colors, shadow, gradients, s } = useUi();
  const brand = accent ?? colors.primary;
  // `secondary` was already passed from ErrorState; it was never a real
  // variant, so the retry control rendered with no fill. Treat it as outline.
  const v = variant === 'secondary' ? 'outline' : variant;
  const isPrimary = v === 'primary';
  const isDanger = v === 'danger';
  const isInverse = v === 'inverse';
  const filled = isPrimary || isDanger;

  const txt = filled ? colors.onPrimary
    : isInverse ? colors.primary
    : v === 'outline' ? brand
    : v === 'soft' ? brand
    : colors.textMuted;

  // minHeight is the tap target. Padding alone on `sm` was ~32pt — a miss
  // under a thumb. 44 / 48 / 52 matches the size names without growing the
  // visual chrome so much that dense rows (Approve / Decline) wrap.
  const pad = size === 'sm' ? { paddingVertical: 10, paddingHorizontal: 14, minHeight: tap }
            : size === 'lg' ? { paddingVertical: 16, paddingHorizontal: 24, minHeight: 52 }
            :                 { paddingVertical: 13, paddingHorizontal: 20, minHeight: 48 };

  const fontSize = size === 'sm' ? font.sm : size === 'lg' ? font.lg : font.md;
  const iconSize = size === 'sm' ? 15 : size === 'lg' ? 20 : 18;

  const skin = v === 'outline' ? { borderWidth: 1.5, borderColor: brand, backgroundColor: 'transparent' }
             : v === 'soft'    ? { backgroundColor: tint(brand, 0.12) }
             : v === 'ghost'   ? { backgroundColor: 'transparent' }
             : null;

  const content = (
    loading ? <ActivityIndicator color={txt} size="small" /> : (
      <View style={s.btnRow}>
        {icon && <Feather name={icon} size={iconSize} color={txt} />}
        <Text style={{ color: txt, fontWeight: font.bold, fontSize, letterSpacing: font.tight }}>{title}</Text>
        {iconRight && <Feather name={iconRight} size={iconSize} color={txt} />}
      </View>
    )
  );

  const off = disabled || loading;

  // White fill on a dark/gradient field (landing). Primary-on-primary was
  // invisible there; a soft white tint was only barely better.
  if (isInverse) {
    return (
      <Pressable3D onPress={onPress} disabled={off} accessibilityLabel={title}
                   style={[s.btn, pad, s.btnInverse, full && { alignSelf: 'stretch' },
                           !off && shadow.card, off && { opacity: 0.5 }, style]}>
        {content}
      </Pressable3D>
    );
  }

  // The gradient is deliberately subtle — a ramp you can see reads dated; one
  // you can only feel reads expensive.
  if (filled) {
    const ramp = isDanger ? gradients.danger
      : brand === colors.primary ? gradients.primary
      : [brand, brand];
    return (
      <Pressable3D onPress={onPress} disabled={off} accessibilityLabel={title}
                   style={[full && { alignSelf: 'stretch' }, !off && shadow.floating, off && { opacity: 0.5 }, style]}>
        <LinearGradient colors={ramp} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                        style={[s.btn, pad]}>
          {content}
        </LinearGradient>
      </Pressable3D>
    );
  }

  return (
    <Pressable3D onPress={onPress} disabled={off} accessibilityLabel={title}
                 style={[s.btn, pad, skin, full && { alignSelf: 'stretch' }, off && { opacity: 0.5 }, style]}>
      {content}
    </Pressable3D>
  );
}

/** 44pt back control. The screens used a 22px icon with no hit slop, so the
 *  tap target was the glyph. Spacer on the other side of the title should
 *  match this width so the title stays centred. */
export function BackButton({ onPress, color }) {
  const { colors, s } = useUi();
  return (
    <TouchableOpacity
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={s.backBtn}
    >
      <Feather name="arrow-left" size={22} color={color || colors.text} />
    </TouchableOpacity>
  );
}

/* ── Input ────────────────────────────────────────────────────────────────── */
// Focus is shown with a tinted ring rather than a colour swap: it marks the
// active field without making the form look like it has an error.
export function Input({ label, icon, error, hint, style, required, onFocus, onBlur, right, ...props }) {
  const { colors, shadow, s } = useUi();
  const [focused, setFocused] = React.useState(false);
  return (
    <View style={{ marginBottom: spacing(3.5) }}>
      {label ? (
        <Text style={s.label}>
          {label}{required ? <Text style={{ color: colors.danger }}> *</Text> : null}
        </Text>
      ) : null}
      <View style={[
        s.inputWrap,
        focused && { borderColor: colors.primary, backgroundColor: colors.surface },
        focused && shadow.soft,
        error && { borderColor: colors.danger, backgroundColor: tint(colors.danger, 0.04) },
      ]}>
        {icon && <Feather name={icon} size={16} color={focused ? colors.primary : colors.textSubtle} style={{ marginRight: 10 }} />}
        <TextInput
          placeholderTextColor={colors.textSubtle}
          style={[s.input, style]}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          {...props}
        />
        {right || null}
      </View>
      {error ? <Text style={s.errorText}>{error}</Text>
        : hint ? <Text style={s.hintText}>{hint}</Text> : null}
    </View>
  );
}

/* ── Select ───────────────────────────────────────────────────────────────────
 * The one dropdown for mobile — the twin of web's <FormSelect>.
 *
 * Screens used to render option lists as chip rows. That is fine for three
 * choices and unusable for thirty: the domain picker was a horizontal scroll a
 * student had to swipe through, with no way to jump to what they wanted. Every
 * list is searchable here, matching web, so the interaction is the same on both
 * surfaces and does not change under the user when an admin adds rows.
 *
 * Options are `[{ value, label }]` — the exact shape /auth/masters returns, so a
 * picker is usually `options={lists.cohort_level}` with nothing in between.
 *
 *   <Select label="Level" required value={form.level} onChange={set('level')}
 *           options={lists.cohort_level} placeholder="Pick a level" />
 */
export function Select({
  label, value, onChange, options = [], placeholder = 'Select…',
  required, error, hint, icon, disabled,
  clearable,
  searchable = true,
  accent,
}) {
  const { colors, shadow, s } = useUi();
  const brand = accent ?? colors.primary;
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');

  const items = React.useMemo(
    () => (options || []).map(o =>
      (typeof o === 'string' ? { value: o, label: o } : o)).filter(Boolean),
    [options],
  );
  const picked = items.find(o => String(o.value) === String(value));
  const canClear = clearable ?? !required;

  // Prefix matches first — typing "te" should reach Telangana before
  // "Uttarakhand", which merely contains the letters.
  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    const starts = [], has = [];
    for (const o of items) {
      const l = String(o.label ?? '').toLowerCase();
      if (l.startsWith(q)) starts.push(o);
      else if (l.includes(q)) has.push(o);
    }
    return [...starts, ...has];
  }, [items, query]);

  const close = () => { setOpen(false); setQuery(''); };
  const choose = (v) => { onChange?.(v); close(); };

  return (
    <View style={{ marginBottom: spacing(3.5) }}>
      {label ? (
        <Text style={s.label}>
          {label}{required ? <Text style={{ color: colors.danger }}> *</Text> : null}
        </Text>
      ) : null}

      <TouchableOpacity
        activeOpacity={0.75}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={[
          s.inputWrap,
          open && { borderColor: brand, ...shadow.soft },
          error && { borderColor: colors.danger, backgroundColor: tint(colors.danger, 0.04) },
          disabled && { opacity: 0.55 },
        ]}
      >
        {icon && <Feather name={icon} size={16} color={open ? brand : colors.textSubtle} style={{ marginRight: 10 }} />}
        <Text numberOfLines={1} style={[s.input, !picked && { color: colors.textSubtle }]}>
          {picked ? picked.label : placeholder}
        </Text>
        {picked && canClear ? (
          <TouchableOpacity onPress={() => onChange?.('')} hitSlop={12} style={{ paddingLeft: 6 }}>
            <Feather name="x" size={15} color={colors.textSubtle} />
          </TouchableOpacity>
        ) : (
          <Feather name="chevron-down" size={16} color={colors.textSubtle} />
        )}
      </TouchableOpacity>

      {error ? <Text style={s.errorText}>{error}</Text>
        : hint ? <Text style={s.hintText}>{hint}</Text> : null}

      {open ? (
        <Sheet onClose={close} title={label || 'Select'} height="72%">
          {searchable ? (
            <View style={[s.inputWrap, { marginBottom: spacing(3) }]}>
              <Feather name="search" size={15} color={colors.textSubtle} style={{ marginRight: 10 }} />
              <TextInput
                autoFocus
                value={query}
                onChangeText={setQuery}
                placeholder="Search…"
                placeholderTextColor={colors.textSubtle}
                style={s.input}
                returnKeyType="search"
              />
              {query ? (
                <TouchableOpacity onPress={() => setQuery('')} hitSlop={12}>
                  <Feather name="x" size={15} color={colors.textSubtle} />
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          <FlatList
            data={shown}
            keyExtractor={(o) => String(o.value)}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            ListEmptyComponent={
              <Text style={[s.muted, { textAlign: 'center', paddingVertical: spacing(6) }]}>
                {items.length ? `Nothing matches “${query}”.` : 'No options available yet.'}
              </Text>
            }
            renderItem={({ item: o }) => {
              const on = String(o.value) === String(value);
              return (
                <TouchableOpacity onPress={() => choose(o.value)}
                                  style={[s.optRow, on && { backgroundColor: tint(brand, 0.1) }]}>
                  <Text style={[s.optText, on && { color: brand, fontWeight: font.bold }]}>{o.label}</Text>
                  {on ? <Feather name="check" size={16} color={brand} /> : null}
                </TouchableOpacity>
              );
            }}
          />
        </Sheet>
      ) : null}
    </View>
  );
}

/* ── Pill ─────────────────────────────────────────────────────────────────── */
export function Pill({ label, tone = 'neutral', style, icon }) {
  const { colors, s } = useUi();
  const map = {
    neutral: [colors.surfaceAlt, colors.textMuted],
    primary: [colors.primarySoft, colors.primaryDark],
    success: [colors.successSoft, colors.success],
    warning: [colors.warningSoft, colors.warning],
    danger:  [colors.dangerSoft, colors.danger],
    info:    [colors.infoSoft, colors.info],
    achiever:[colors.achieverSoft, colors.achieverDark],
  };
  const [bg, fg] = map[tone] || map.neutral;
  return (
    <View style={[s.pill, { backgroundColor: bg }, style]}>
      {icon && <Feather name={icon} size={10} color={fg} />}
      <Text style={{ color: fg, fontSize: font.xs, fontWeight: font.bold, textTransform: 'capitalize', letterSpacing: font.wide }}>
        {label}
      </Text>
    </View>
  );
}

/** Filter chip. Screens each rolled their own 28pt pill; this one is 38pt so
 *  a thumb can actually land on "Upcoming" / "To do" / "All types". */
export function Chip({ label, on, onPress, style, icon }) {
  const { colors, s } = useUi();
  return (
    <TouchableOpacity
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!on }}
      style={[s.selChip, on && s.selChipOn, style]}
    >
      {icon ? (
        <Feather name={icon} size={13} color={on ? colors.onPrimary : colors.textMuted} style={{ marginRight: 6 }} />
      ) : null}
      <Text style={[s.selChipText, on && s.selChipTextOn]} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

export function ChipRow({ children, wrap }) {
  if (wrap) {
    return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
  }
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
      {children}
    </ScrollView>
  );
}

/** Two-or-more equal segments (Bookings Cohorts / 1-on-1). */
export function Segmented({ options, value, onChange, style }) {
  const { s } = useUi();
  return (
    <View style={[s.seg, style]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <TouchableOpacity
            key={o.value}
            onPress={() => onChange(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            style={[s.segItem, on && s.segOn]}
          >
            <Text style={[s.segText, on && s.segTextOn]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

/* ── Avatar ───────────────────────────────────────────────────────────────── */
export function Avatar({ name, size = 44, color }) {
  const { colors } = useUi();
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  // Same name, same colour, every time — a face you start to recognise beats a
  // wall of identical indigo circles.
  const palette = [colors.primary, colors.achiever, colors.info, colors.success, colors.warning];
  const picked = color || palette[initial.charCodeAt(0) % palette.length];
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2.6,
      backgroundColor: picked, alignItems: 'center', justifyContent: 'center',
    }}>
      <Text style={{ color: '#fff', fontWeight: font.black, fontSize: size * 0.4 }}>{initial}</Text>
    </View>
  );
}

/* ── Section header ───────────────────────────────────────────────────────── */
export function SectionHeader({ title, action, onAction, subtitle }) {
  const { colors, s } = useUi();
  return (
    <View style={{ marginBottom: spacing(3), marginTop: spacing(2) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={s.section}>{title}</Text>
        {action ? (
          <TouchableOpacity onPress={onAction} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={{ color: colors.primary, fontWeight: font.bold, fontSize: font.sm }}>{action}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {subtitle ? <Text style={[s.muted, { marginTop: 2 }]}>{subtitle}</Text> : null}
    </View>
  );
}

/* ── Loading ──────────────────────────────────────────────────────────────── */
export const Loader = ({ label }) => {
  const { colors, s } = useUi();
  return (
  <View style={{ paddingVertical: spacing(12), alignItems: 'center' }}>
    <ActivityIndicator color={colors.primary} />
    {label ? <Text style={[s.muted, { marginTop: 10 }]}>{label}</Text> : null}
  </View>
  );
};

/** Shimmering placeholder. A skeleton in the shape of the answer reads as
 *  "almost there"; a spinner reads as "something is wrong". */
export function Skeleton({ width = '100%', height = 14, style, radius: r = radius.sm }) {
  const { colors } = useUi();
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(t, { toValue: 0, duration: 800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [t]);
  return (
    <Animated.View style={[
      { width, height, borderRadius: r, backgroundColor: colors.surfaceAlt },
      { opacity: t.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) },
      style,
    ]} />
  );
}

/** A stack of card-shaped skeletons — the usual "list is loading" case. */
export function SkeletonList({ count = 3, height = 96 }) {
  return (
    <View style={{ gap: spacing(3) }}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} height={height} radius={radius.lg} />
      ))}
    </View>
  );
}

/* ── Empty ────────────────────────────────────────────────────────────────── */
export function Empty({ icon = 'inbox', title, subtitle, action, onAction }) {
  const { colors, s } = useUi();
  return (
    <FadeIn style={{ paddingVertical: spacing(12), alignItems: 'center' }}>
      <View style={s.emptyIcon}>
        <Feather name={icon} size={26} color={colors.primary} />
      </View>
      <Text style={{ fontSize: font.md, fontWeight: font.bold, color: colors.text }}>{title}</Text>
      {subtitle ? (
        <Text style={[s.muted, { marginTop: 6, textAlign: 'center', paddingHorizontal: spacing(6), lineHeight: 19 }]}>
          {subtitle}
        </Text>
      ) : null}
      {action ? <Button title={action} onPress={onAction} size="sm" style={{ marginTop: spacing(4) }} /> : null}
    </FadeIn>
  );
}

/* ── ErrorState ───────────────────────────────────────────────────────────── */
// `Empty` and `ErrorState` are not interchangeable. "No bookings yet" and
// "we couldn't load your bookings" are different facts, and showing the first
// when the second is true hides an outage from the person it affects. Every
// screen that fetches needs both, tracked separately - a catch that leaves the
// list empty is a bug, not an empty state.
export function ErrorState({
  title = "We couldn't load this",
  subtitle = 'Nothing is lost — this is a connection problem.',
  onRetry,
}) {
  const { colors, s } = useUi();
  return (
    <FadeIn style={{ paddingVertical: spacing(10), alignItems: 'center' }}>
      <View style={[s.emptyIcon, { backgroundColor: tint(colors.danger, 0.12) }]}>
        <Feather name="alert-triangle" size={26} color={colors.danger} />
      </View>
      <Text style={{ fontSize: font.md, fontWeight: font.bold, color: colors.text }}>{title}</Text>
      <Text style={[s.muted, { marginTop: 6, textAlign: 'center', paddingHorizontal: spacing(6), lineHeight: 19 }]}>
        {subtitle}
      </Text>
      {onRetry ? (
        <Button title="Try again" onPress={onRetry} size="sm" variant="outline"
                style={{ marginTop: spacing(4) }} />
      ) : null}
    </FadeIn>
  );
}

/* ── Toast ────────────────────────────────────────────────────────────────── */
// Alert.alert() is a blocking, OS-owned modal. It is right for a question and
// wrong for "Saved" - the app used it 98 times, so confirming anything meant
// dismissing a dialog. This says the same thing without stealing the tap.
const ToastCtx = React.createContext(null);

export function ToastProvider({ children }) {
  const { colors, s } = useUi();
  const [toast, setToast] = React.useState(null);
  const y = useRef(new Animated.Value(80)).current;
  const timer = useRef(null);

  const hide = React.useCallback(() => {
    Animated.timing(y, { toValue: 80, duration: motion.fast, easing: Easing.in(Easing.cubic),
      useNativeDriver: true }).start(() => setToast(null));
  }, [y]);

  const push = React.useCallback((text, tone) => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ text, tone });
    y.setValue(80);
    Animated.timing(y, { toValue: 0, duration: motion.base, easing: Easing.out(Easing.cubic),
      useNativeDriver: true }).start();
    // Errors linger: they are more likely to need reading twice.
    timer.current = setTimeout(hide, tone === 'error' ? 4200 : 2600);
  }, [y, hide]);

  const api = React.useMemo(() => ({
    success: (t) => push(t, 'success'),
    error:   (t) => push(t, 'error'),
    info:    (t) => push(t, 'info'),
  }), [push]);

  const toneColor = toast?.tone === 'error' ? colors.danger
    : toast?.tone === 'success' ? colors.success : colors.text;
  const icon = toast?.tone === 'error' ? 'alert-circle'
    : toast?.tone === 'success' ? 'check-circle' : 'info';

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {toast ? (
        <Animated.View pointerEvents="box-none"
          style={[s.toastWrap, { transform: [{ translateY: y }] }]}>
          <Pressable onPress={hide} style={[s.toast, { borderLeftColor: toneColor }]}>
            <Feather name={icon} size={16} color={toneColor} />
            <Text style={s.toastText} numberOfLines={3}>{toast.text}</Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </ToastCtx.Provider>
  );
}

// No-ops outside a provider, so an isolated screen render never throws.
export function useToast() {
  return React.useContext(ToastCtx) || { success: () => {}, error: () => {}, info: () => {} };
}

/* ── Stat ─────────────────────────────────────────────────────────────────── */
export function Stat({ icon, value, label, tone = 'primary', index }) {
  const { colors, s } = useUi();
  const map = { primary: colors.primary, success: colors.success, warning: colors.warning,
                achiever: colors.achiever, info: colors.info, danger: colors.danger };
  const c = map[tone] || colors.primary;
  return (
    <Card index={index} style={{ flex: 1, padding: spacing(4) }}>
      <View style={{ width: 38, height: 38, borderRadius: radius.sm, backgroundColor: tint(c, 0.12),
                     alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
        <Feather name={icon} size={18} color={c} />
      </View>
      <Text style={{ fontSize: font.xl, fontWeight: font.black, color: colors.text, letterSpacing: font.tight }}>
        {value}
      </Text>
      <Text style={[s.muted, { marginTop: 2 }]} numberOfLines={2}>{label}</Text>
    </Card>
  );
}

/* ── Sheet ────────────────────────────────────────────────────────────────────
 * The bottom sheet every create/edit flow renders into. Screens used to hand-roll
 * this (same Modal + overlay + rounded header, copied per screen), so a change to
 * the chrome meant editing each one. One component, one look.
 *
 * `height` accepts a percent string ('85%') or a number; omit it and the sheet
 * hugs its content, which is what a short confirm/pick flow wants.
 */
export function Sheet({ visible = true, onClose, title, subtitle, height, children, footer }) {
  const { colors, s } = useUi();
  return (
    <RNModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Tapping the dimmed area closes — expected on Android, and the only
            dismissal affordance when a sheet has no cancel button. */}
        <Pressable style={s.sheetWrap} onPress={onClose}>
          {/* Stop taps inside the sheet from bubbling up to the backdrop. */}
          <Pressable style={[s.sheet, height ? { height } : null]} onPress={() => {}}>
            <View style={s.sheetGrip} />
            {title ? (
              <View style={s.sheetHead}>
                <View style={{ flex: 1 }}>
                  <Text style={s.h2}>{title}</Text>
                  {subtitle ? <Text style={[s.muted, { marginTop: 2 }]}>{subtitle}</Text> : null}
                </View>
                <TouchableOpacity onPress={onClose} hitSlop={8} style={s.sheetClose} accessibilityRole="button" accessibilityLabel="Close">
                  <Feather name="x" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ) : null}
            {children}
            {footer ? <View style={s.sheetFoot}>{footer}</View> : null}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

/** Mode tiles + accent grid — the mobile twin of web's ThemeDropdown. */
export function ThemePanel() {
  const { colors, preference, setPreference, accent, setAccent } = useTheme();
  const modes = [
    { value: 'system', icon: 'smartphone', label: 'System' },
    { value: 'light',  icon: 'sun',        label: 'Light' },
    { value: 'dark',   icon: 'moon',       label: 'Dark' },
  ];
  return (
    <View>
      <Text style={{ fontSize: font.xs, fontWeight: font.bold, color: colors.textMuted,
                     letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 }}>
        Mode
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: spacing(5) }}>
        {modes.map((m) => {
          const on = preference === m.value;
          return (
            <TouchableOpacity
              key={m.value}
              onPress={() => setPreference(m.value)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${m.label} appearance`}
              style={{
                flex: 1, minHeight: 76, borderRadius: radius.md, alignItems: 'center',
                justifyContent: 'center', gap: 8,
                backgroundColor: on ? colors.primary : colors.surfaceAlt,
                borderWidth: on ? 0 : 1, borderColor: colors.border,
              }}
            >
              <Feather name={m.icon} size={18} color={on ? colors.onPrimary : colors.textMuted} />
              <Text style={{
                fontSize: font.xs, fontWeight: font.bold,
                color: on ? colors.onPrimary : colors.textMuted,
              }}>{m.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={{ fontSize: font.xs, fontWeight: font.bold, color: colors.textMuted,
                     letterSpacing: 0.8, textTransform: 'uppercase', marginBottom: 10 }}>
        Accent colour
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {ACCENTS.map((t) => {
          const on = accent === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setAccent(t.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${t.label} accent`}
              style={{ width: '25%', alignItems: 'center', gap: 6, paddingVertical: 4 }}
            >
              <View style={{
                width: 48, height: 48, borderRadius: 16, backgroundColor: t.hex,
                alignItems: 'center', justifyContent: 'center',
                transform: [{ scale: on ? 1.06 : 1 }],
                borderWidth: on ? 3 : 0, borderColor: colors.surface,
                shadowColor: t.hex, shadowOpacity: on ? 0.45 : 0.2,
                shadowRadius: on ? 10 : 6, shadowOffset: { width: 0, height: 3 },
                elevation: on ? 6 : 2,
              }}>
                {on ? <Feather name="check" size={18} color="#fff" /> : null}
              </View>
              <Text style={{
                fontSize: 10, fontWeight: font.bold,
                color: on ? t.hex : colors.textMuted,
              }}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/** Compact chip (web header control). Opens a sheet with ThemePanel. */
export function ThemeTrigger({ light }) {
  const { colors, isDark, accentMeta, preference } = useTheme();
  const [open, setOpen] = React.useState(false);
  const icon = preference === 'dark' || (preference === 'system' && isDark) ? 'moon' : 'sun';
  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Appearance"
        style={{
          flexDirection: 'row', alignItems: 'center', gap: 8,
          minHeight: tap, paddingHorizontal: 12, borderRadius: radius.pill,
          backgroundColor: light ? 'rgba(255,255,255,0.18)' : colors.surface,
          borderWidth: 1,
          borderColor: light ? 'rgba(255,255,255,0.28)' : colors.border,
        }}
      >
        <View style={{
          width: 14, height: 14, borderRadius: 7, backgroundColor: accentMeta.hex,
          borderWidth: 2, borderColor: light ? 'rgba(255,255,255,0.85)' : colors.surface,
        }} />
        <Feather name={icon} size={14} color={light ? '#fff' : colors.textMuted} />
      </TouchableOpacity>
      <Sheet visible={open} onClose={() => setOpen(false)} title="Appearance"
             subtitle={`${accentMeta.label} · ${preference === 'system' ? 'System' : preference === 'dark' ? 'Dark' : 'Light'}`}>
        <ThemePanel />
      </Sheet>
    </>
  );
}
export function confirm({ title, message, confirmLabel = 'Confirm', destructive = false }) {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

const makeUiStyles = (colors, shadow) => ({
  h1: { fontSize: font.xxl, fontWeight: font.black, color: colors.text, letterSpacing: font.tightest, lineHeight: 36 },
  h2: { fontSize: font.xl, fontWeight: font.bold, color: colors.text, letterSpacing: font.tight, lineHeight: 30 },
  body: { fontSize: font.base, color: colors.text, lineHeight: 24 },
  muted: { fontSize: font.sm, color: colors.textMuted, lineHeight: 20 },
  section: { fontSize: font.lg, fontWeight: font.bold, color: colors.text, letterSpacing: font.tight },

  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(4), ...shadow.card,
    borderWidth: colors.bg === darkColors.bg ? 1 : 0, borderColor: colors.border },
  cardFlat: { ...shadow.none, backgroundColor: colors.surfaceAlt },

  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: spacing(8),
    paddingHorizontal: spacing(4), alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: spacing(2.5),
    backgroundColor: colors.surface, borderRadius: radius.md, borderLeftWidth: 3,
    paddingVertical: spacing(3), paddingHorizontal: spacing(4), maxWidth: 520, width: '100%',
    ...shadow.card },
  toastText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 20 },

  sheetWrap: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing(5), paddingTop: spacing(3), paddingBottom: spacing(6), maxHeight: '92%' },
  sheetGrip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.border, marginBottom: spacing(3) },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing(4) },
  sheetClose: { width: tap, height: tap, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center' },
  sheetFoot: { flexDirection: 'row', gap: 10, marginTop: spacing(4) },

  optRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing(4), paddingVertical: spacing(3.5), borderRadius: radius.md,
    marginBottom: spacing(1.5), backgroundColor: colors.surface, minHeight: tap },
  optText: { flex: 1, fontSize: font.base, color: colors.text },

  btn: { borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  btnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  btnInverse: { backgroundColor: '#FFFFFF' },
  backBtn: { width: tap, height: tap, alignItems: 'center', justifyContent: 'center', marginLeft: -10 },

  label: { fontSize: font.sm, fontWeight: font.semibold, color: colors.textMuted, marginBottom: 7 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 15, minHeight: 52,
  },
  input: { flex: 1, fontSize: font.base, color: colors.text },
  errorText: { color: colors.danger, fontSize: font.xs, marginTop: 6 },
  hintText: { color: colors.textSubtle, fontSize: font.xs, marginTop: 6 },

  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: radius.pill,
    paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start' },

  selChip: { flexDirection: 'row', paddingHorizontal: 16, minHeight: 38, justifyContent: 'center', alignItems: 'center',
    borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
  selChipOn: { backgroundColor: colors.primary },
  selChipText: { fontSize: font.sm, fontWeight: font.bold, color: colors.textMuted, textTransform: 'capitalize' },
  selChipTextOn: { color: colors.onPrimary },

  seg: { flexDirection: 'row', backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
    padding: 4, marginVertical: spacing(4) },
  segItem: { flex: 1, minHeight: 44, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.surface, ...shadow.soft },
  segText: { fontSize: font.sm, fontWeight: font.bold, color: colors.textMuted },
  segTextOn: { color: colors.text },

  emptyIcon: { width: 68, height: 68, borderRadius: radius.lg, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
});

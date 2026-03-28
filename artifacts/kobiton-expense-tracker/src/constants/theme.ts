export const Colors = {
  primary: '#0F2D8A',
  primaryDark: '#091E6A',
  primaryLight: '#2247C4',
  accent: '#00BCD4',
  accentLight: '#4DD0E1',
  white: '#FFFFFF',
  surface: '#F4F6FB',
  surfaceCard: '#FFFFFF',
  border: '#E0E6F0',
  borderFocus: '#0F2D8A',
  textPrimary: '#111827',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  textOnPrimary: '#FFFFFF',
  error: '#DC2626',
  errorLight: '#FEE2E2',
  success: '#059669',
  successLight: '#D1FAE5',
  warning: '#D97706',
  categoryBusiness: '#0F2D8A',
  categoryTravel: '#0891B2',
  categoryMeals: '#059669',
  categoryOffice: '#7C3AED',
  categorySoftware: '#2563EB',
  categoryMisc: '#6B7280',
  overlayDark: 'rgba(0,0,0,0.5)',
  shadowColor: '#000',
};

export const Typography = {
  fontRegular: 'Inter_400Regular',
  fontMedium: 'Inter_500Medium',
  fontSemiBold: 'Inter_600SemiBold',
  fontBold: 'Inter_700Bold',
  sizeXs: 11,
  sizeSm: 13,
  sizeMd: 15,
  sizeLg: 17,
  sizeXl: 20,
  size2xl: 24,
  size3xl: 30,
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const Radius = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 24,
  full: 9999,
};

export const Shadow = {
  card: {
    shadowColor: Colors.shadowColor,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  button: {
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
};

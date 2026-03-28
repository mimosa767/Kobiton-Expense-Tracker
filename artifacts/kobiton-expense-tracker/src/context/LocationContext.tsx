import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import * as Location from 'expo-location';
import { Platform } from 'react-native';

export interface GeoPoint {
  latitude: number;
  longitude: number;
  city?: string;
  country?: string;
}

interface LocationContextValue {
  realLocation: GeoPoint | null;
  mockLocation: GeoPoint | null;
  currentLocation: GeoPoint | null;
  isMocked: boolean;
  permissionStatus: 'granted' | 'denied' | 'undetermined' | 'loading';
  setMockLocation: (point: GeoPoint) => void;
  clearMock: () => void;
  refreshReal: () => Promise<void>;
}

const LocationContext = createContext<LocationContextValue | null>(null);

async function reverseGeocode(lat: number, lng: number): Promise<{ city?: string; country?: string }> {
  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (results && results.length > 0) {
      const r = results[0];
      return {
        city: r.city ?? r.subregion ?? r.region ?? undefined,
        country: r.country ?? undefined,
      };
    }
  } catch {
  }
  return {};
}

export function LocationProvider({ children }: { children: React.ReactNode }) {
  const [realLocation, setRealLocation] = useState<GeoPoint | null>(null);
  const [mockLocation, setMockLocationState] = useState<GeoPoint | null>(null);
  const [permissionStatus, setPermissionStatus] = useState<
    'granted' | 'denied' | 'undetermined' | 'loading'
  >('loading');

  const refreshReal = useCallback(async () => {
    if (Platform.OS === 'web') {
      setPermissionStatus('denied');
      return;
    }
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setPermissionStatus(status as 'granted' | 'denied');
      if (status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const { city, country } = await reverseGeocode(
          pos.coords.latitude,
          pos.coords.longitude
        );
        setRealLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          city,
          country,
        });
      }
    } catch {
      setPermissionStatus('denied');
    }
  }, []);

  useEffect(() => {
    refreshReal();
  }, [refreshReal]);

  function setMockLocation(point: GeoPoint) {
    setMockLocationState(point);
  }

  function clearMock() {
    setMockLocationState(null);
  }

  const currentLocation = mockLocation ?? realLocation;
  const isMocked = mockLocation !== null;

  return (
    <LocationContext.Provider
      value={{
        realLocation,
        mockLocation,
        currentLocation,
        isMocked,
        permissionStatus,
        setMockLocation,
        clearMock,
        refreshReal,
      }}
    >
      {children}
    </LocationContext.Provider>
  );
}

export function useLocation() {
  const ctx = useContext(LocationContext);
  if (!ctx) throw new Error('useLocation must be used within LocationProvider');
  return ctx;
}

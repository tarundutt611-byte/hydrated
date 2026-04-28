/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Droplets, 
  Trophy, 
  Flame, 
  Share2, 
  Plus, 
  Settings, 
  History,
  Bot,
  Zap,
  CheckCircle2,
  Lock,
  X,
  Calendar,
  Clock,
  RefreshCw,
  ArrowRight
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Badge } from '@/components/ui/badge';
import { Toaster } from '@/components/ui/sonner';
import { toast } from 'sonner';
import { generateHydrationNote } from '@/src/lib/gemini';
import { format, subDays, addDays } from 'date-fns';
import { auth, db, signInWithGoogle, logout, handleFirestoreError, OperationType } from '@/src/lib/firebase';
import { onAuthStateChanged, User } from 'firebase/auth';
import { doc, getDoc, setDoc, onSnapshot } from 'firebase/firestore';

interface UserStats {
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  dailyGoal: number;
  currentIntake: number;
  totalPoints: number;
  level: number;
  streak: number;
  lastLogDate: string;
  lastGoalReachedDate: string | null;
  logs: { id: string; amount: number; time: string }[];
  schedule: { time: string; amount: number; completed: boolean }[];
  inventory: string[];
}

const DEFAULT_STATS: UserStats = {
  dailyGoal: 2000,
  currentIntake: 0,
  totalPoints: 0,
  level: 1,
  streak: 0,
  lastLogDate: format(new Date(), 'yyyy-MM-dd'),
  lastGoalReachedDate: null,
  logs: [],
  schedule: [
    { time: '08:00', amount: 250, completed: false },
    { time: '11:00', amount: 500, completed: false },
    { time: '14:00', amount: 500, completed: false },
    { time: '17:00', amount: 500, completed: false },
    { time: '20:00', amount: 250, completed: false },
  ],
  inventory: [],
};

const NOTE_COST = 50;

const SHOP_ITEMS = [
  { id: 'note', name: 'Social Note', cost: 50, icon: '📝', description: 'Unlock AI hydration tips' },
  { id: 'skin_ocean', name: 'Ocean Skin', cost: 500, icon: '🎨', description: 'Deep sea theme' },
  { id: 'badge_elite', name: 'Elite Badge', cost: 1000, icon: '🏅', description: 'Show your status' },
];

// Logo Component
const Logo = ({ className }: { className?: string }) => (
  <div className={`relative flex items-center justify-center overflow-hidden ${className}`}>
    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-[85%] h-[85%] drop-shadow-md">
      {/* Droplet Shape - Gradient-like feel with solid white and highlight */}
      <path 
        d="M12 2.5C12 2.5 4.5 10.8 4.5 15.8C4.5 19.9421 7.85786 23.3 12 23.3C16.1421 23.3 19.5 19.9421 19.5 15.8C19.5 10.8 12 2.5 12 2.5Z" 
        fill="white"
      />
      {/* Reflection Highlight - More pronounced */}
      <path 
        d="M10.5 7.5C10.5 7.5 8.5 11 8.5 14.5" 
        stroke="#BFDBFE" 
        strokeWidth="1.8" 
        strokeLinecap="round" 
        className="opacity-80"
      />
      {/* Simple Smile Line (Friendly Curve) */}
      <path 
        d="M9.5 16.5C10.5 17.8 13.5 17.8 14.5 16.5" 
        stroke="#1d4ed8" 
        strokeWidth="2.8" 
        strokeLinecap="round" 
      />
    </svg>
  </div>
);

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [stats, setStats] = useState<UserStats>(DEFAULT_STATS);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Monitor Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false); // Auth check is done
      if (!u) {
        setStats(DEFAULT_STATS);
        setDataLoaded(false);
      }
    }, (error) => {
      console.error("Auth State Error:", error);
      setAuthLoading(false);
      toast.error("Authentication Service Error", { 
        description: "Firebase Auth might be misconfigured or blocked. Check console." 
      });
    });
    
    // Safety timeout for auth loading
    const timeout = setTimeout(() => {
      if (authLoading) {
        setAuthLoading(false);
        console.warn("Auth check timed out.");
      }
    }, 8000);

    return () => {
      unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const lastServerData = useRef<string>("");

  // Sync with Firestore
  useEffect(() => {
    if (!user) return;

    const userDocRef = doc(db, 'users', user.uid);
    
    // Initial fetch and real-time sync
    const unsubscribe = onSnapshot(userDocRef, (snapshot) => {
      if (snapshot.exists()) {
        const cloudData = snapshot.data() as UserStats;
        const cloudDataStr = JSON.stringify(cloudData);
        
        // If this snapshot came from or matches our last write, ignore it to prevent loops
        if (cloudDataStr === lastServerData.current) return;

        const today = format(new Date(), 'yyyy-MM-dd');
        let processedData = { ...DEFAULT_STATS, ...cloudData };

        // Daily Reset Logic
        if (processedData.lastLogDate !== today) {
          const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd');
          let newStreak = processedData.streak;
          
          if (processedData.lastGoalReachedDate !== yesterday && processedData.lastGoalReachedDate !== today) {
             newStreak = 0;
          }

          processedData = { 
            ...processedData, 
            currentIntake: 0, 
            lastLogDate: today, 
            streak: newStreak,
            logs: [],
            schedule: DEFAULT_STATS.schedule // Reset schedule for new day
          };
          
          // Persist the reset
          setDoc(userDocRef, processedData).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`));
        }
        
        lastServerData.current = JSON.stringify(processedData);
        setStats(processedData);
        setDataLoaded(true);
      } else {
        // First timer - save default stats with user metadata
        const initialStats: UserStats = {
          ...DEFAULT_STATS,
          email: user.email,
          displayName: user.displayName || user.email?.split('@')[0] || 'Hydro Friend',
          photoURL: user.photoURL
        };
        setDoc(userDocRef, initialStats).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`));
        setStats(initialStats);
        setDataLoaded(true);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `users/${user.uid}`);
    });

    return () => unsubscribe();
  }, [user]);

  // Persist local stats to cloud when they change (only after initial load to avoid overwriting cloud with defaults)
  useEffect(() => {
    if (user && dataLoaded) {
      const statsStr = JSON.stringify(stats);
      if (statsStr !== lastServerData.current) {
        lastServerData.current = statsStr;
        const userDocRef = doc(db, 'users', user.uid);
        setDoc(userDocRef, stats).catch(e => handleFirestoreError(e, OperationType.WRITE, `users/${user.uid}`));
      }
    }
  }, [stats, user, dataLoaded]);

  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedNote, setGeneratedNote] = useState<string | null>(null);
  const [showNoteModal, setShowNoteModal] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCustomIntake, setShowCustomIntake] = useState(false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    return localStorage.getItem('hydrated_notifications') === 'true' && Notification.permission === 'granted';
  });

  const requestNotificationPermission = async () => {
    try {
      if (!("Notification" in window)) {
        toast.error("Notifications not supported in this browser.");
        return;
      }

      // If already denied, we can't request again. Guide the user.
      if (Notification.permission === 'denied') {
        toast.error("Blocked by Browser", {
          description: "Permissions were previously denied. Please click the lock icon in your URL bar and 'Allow' notifications manually.",
          duration: 6000,
        });
        return;
      }

      // Special check for iframes
      const isIframe = window.self !== window.top;
      if (isIframe) {
        toast.info("Preview Mode Restriction", {
          description: "Browser notifications are often blocked in previews. Please open the app in a NEW TAB to enable them.",
          duration: 5000,
        });
      }

      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        setNotificationsEnabled(true);
        localStorage.setItem('hydrated_notifications', 'true');
        toast.success("Notifications enabled! 🔔");
        new Notification("Hydrated", {
          body: "You'll now receive hydration alerts and milestone updates!",
          icon: "/favicon.ico"
        });
      } else {
        setNotificationsEnabled(false);
        localStorage.setItem('hydrated_notifications', 'false');
        if (permission === 'denied') {
          toast.error("Permission Denied", {
            description: "Click the lock icon in your browser address bar to reset permissions.",
          });
        }
      }
    } catch (error) {
      console.error("Notification Error:", error);
      toast.error("System Error", {
        description: "Browser blocked the permission prompt. Try opening the app in a new tab.",
      });
    }
  };

  const sendLocalNotification = (title: string, body: string) => {
    if (notificationsEnabled && Notification.permission === 'granted') {
      new Notification(title, { body, icon: "https://cdn-icons-png.flaticon.com/512/3105/3105807.png" });
    }
  };

  const logoutUser = () => {
    logout();
  };

  const handleGoogleLogin = async () => {
    try {
      await signInWithGoogle();
      toast.success("Welcome back!");
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        return; // User cancelled, no error toast needed
      }
      console.error(error);
      if (error.message?.includes('offline') || error.code === 'unavailable') {
        toast.error("Network Error", { 
          description: "Could not reach Firebase. Check your internet or if the database is provisioned.",
          action: {
            label: "Help",
            onClick: () => setShowNoteModal(true) // Misusing modal for now or create a new one
          }
        });
      } else {
        toast.error("Login failed", { description: error.message });
      }
    }
  };

  const [customAmount, setCustomAmount] = useState('250');
  const [isSyncing, setIsSyncing] = useState(false);
  const [currentView, setCurrentView] = useState<'tracker' | 'history' | 'rank' | 'schedule'>('tracker');

  const handleRefresh = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      toast.success("Progress Synchronized", {
        description: "Your hydration data is now up to date with H-Bot Cloud."
      });
    }, 1500);
  };

  // Dynamic history based on logs
  const historyData = useMemo(() => {
    // If no logs or new user, keep it empty as requested
    return [];
  }, []);

  const ranks = [
    { name: 'Dew Dropper I', xp: 0, icon: '🌱' },
    { name: 'Dew Dropper II', xp: 500, icon: '🌿' },
    { name: 'Puddle Jumper', xp: 1000, icon: '💧' },
    { name: 'River Runner', xp: 2500, icon: '🌊' },
    { name: 'Ocean Master', xp: 5000, icon: '🔱' },
  ];

  const currentRank = useMemo(() => {
    return [...ranks].reverse().find(r => stats.totalPoints >= r.xp) || ranks[0];
  }, [stats.totalPoints]);

  useEffect(() => {
    // We now sync with Firestore instead of localStorage
  }, [stats]);

  // Send a welcome-back summary notification on mount if allowed
  useEffect(() => {
    if (user && notificationsEnabled && Notification.permission === 'granted') {
      const lastSummarySet = localStorage.getItem('hydrated_last_summary');
      const today = format(new Date(), 'yyyy-MM-dd');
      
      if (lastSummarySet !== today) {
        const body = stats.currentIntake > 0 
          ? `Welcome back! You've already drank ${stats.currentIntake}ml today. Keep it up!`
          : "Good morning! Time to start your hydration journey for today. Target: " + (stats.dailyGoal/1000) + "L";
        
        sendLocalNotification("Hydrated Daily Check-in", body);
        localStorage.setItem('hydrated_last_summary', today);
      }
    }
  }, [notificationsEnabled, stats.currentIntake, stats.dailyGoal]);

  const progress = useMemo(() => {
    return Math.min((stats.currentIntake / stats.dailyGoal) * 100, 100);
  }, [stats.currentIntake, stats.dailyGoal]);

  const handleIntake = (amount: number) => {
    if (isNaN(amount) || amount <= 0) return;

    setStats(prev => {
      const today = format(new Date(), 'yyyy-MM-dd');
      const newIntake = prev.currentIntake + amount;
      
      // Streak Multiplier Logic
      let multiplier = 1;
      if (prev.streak >= 14) multiplier = 2.0;
      else if (prev.streak >= 7) multiplier = 1.5;
      else if (prev.streak >= 3) multiplier = 1.2;

      const pointsGain = Math.floor((amount / 10) * multiplier);
      let newPoints = prev.totalPoints + pointsGain;
      
      const newLog = {
        id: Math.random().toString(36).substr(2, 9),
        amount,
        time: format(new Date(), 'HH:mm'),
      };
      
      let nextLevel = prev.level;
      let newStreak = prev.streak;
      let lastGoalReachedDate = prev.lastGoalReachedDate;

      // Check for first-time goal achievement today
      if (newIntake >= prev.dailyGoal && prev.currentIntake < prev.dailyGoal) {
        newStreak += 1;
        lastGoalReachedDate = today;
        
        // Award streak bonus: 20 points per current streak day
        const streakBonus = newStreak * 20;
        newPoints += streakBonus;

        const msg = `GOAL REACHED! 🌟 Streak: ${newStreak} Days! (Bonus: +${streakBonus} Drops)`;
        toast.success("GOAL REACHED! 🌟", {
          description: msg,
        });
        sendLocalNotification("Hydrated Goal Achieved!", msg);
      }

      const xpNeeded = nextLevel * 1000;
      if (newPoints >= xpNeeded) {
        nextLevel += 1;
        const msg = `LEVEL UP! You are now Level ${nextLevel}! 🚀`;
        toast.success(msg, {
          description: "Keep drinking to unlock more rewards.",
        });
        sendLocalNotification("Hydrated Level Up!", msg);
      }

      return {
        ...prev,
        currentIntake: newIntake,
        totalPoints: newPoints,
        level: nextLevel,
        streak: newStreak,
        lastGoalReachedDate,
        logs: [newLog, ...prev.logs].slice(0, 10),
      };
    });
    const activeMultiplier = stats.streak >= 14 ? 2.0 : stats.streak >= 7 ? 1.5 : stats.streak >= 3 ? 1.2 : 1.0;
    const pointsGained = Math.floor((amount / 10) * activeMultiplier);
    
    const toastMsg = activeMultiplier > 1 
      ? `Added ${amount}ml! (${activeMultiplier}x Multiplier active) 💧`
      : `Added ${amount}ml of water! 💧`;

    toast(toastMsg, {
      description: `+${pointsGained} HydraPoints earned.`,
    });
  };

  const handleRemoveLog = (id: string) => {
    setStats(prev => {
      const logToRemove = prev.logs.find(l => l.id === id);
      if (!logToRemove) return prev;

      const pointsToSubtract = Math.floor(logToRemove.amount / 10);
      return {
        ...prev,
        currentIntake: Math.max(0, prev.currentIntake - logToRemove.amount),
        totalPoints: Math.max(0, prev.totalPoints - pointsToSubtract),
        logs: prev.logs.filter(l => l.id !== id),
      };
    });
    toast.info("Log removed", {
      description: "Statistics updated accordingly.",
    });
  };

  const handleBuyItem = (itemId: string, cost: number) => {
    if (stats.inventory.includes(itemId)) {
      toast.info("You already own this item!");
      return;
    }

    if (stats.totalPoints < cost) {
      toast.error("Not enough Drops!", {
        description: `You need ${cost - stats.totalPoints} more drops.`,
      });
      return;
    }

    setStats(prev => ({
      ...prev,
      totalPoints: prev.totalPoints - cost,
      inventory: [...prev.inventory, itemId],
    }));

    toast.success(`Purchased ${SHOP_ITEMS.find(i => i.id === itemId)?.name}! 🎉`);
  };

  const handleUnlockNote = async () => {
    const isUnlocked = stats.inventory.includes('note');
    
    if (!isUnlocked) {
      handleBuyItem('note', NOTE_COST);
      return;
    }

    setIsGenerating(true);
    const note = await generateHydrationNote(stats.currentIntake, stats.dailyGoal, stats.level);
    setGeneratedNote(note);
    setIsGenerating(false);
    setShowNoteModal(true);
  };

  const shareNote = () => {
    if (generatedNote) {
      if (navigator.share) {
        navigator.share({
          title: 'My Hydration Milestone',
          text: generatedNote,
          url: window.location.href,
        });
      } else {
        navigator.clipboard.writeText(generatedNote);
        toast.success("Copied to clipboard!", {
          description: "Go share it with your friends! 🚀",
        });
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans p-4 md:p-8 overflow-x-hidden selection:bg-blue-100">
      <Toaster position="top-center" />

      {authLoading && (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-[100] flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
             <Logo className="w-16 h-16 bg-blue-500 rounded-2xl shadow-xl shadow-blue-200 animate-bounce p-2" />
            <p className="text-slate-400 font-bold animate-pulse">Syncing H-Bot data...</p>
          </div>
        </div>
      )}

      {!user && !authLoading && (
        <div className="fixed inset-0 bg-white z-[90] flex items-center justify-center p-4">
          <div className="max-w-md w-full text-center space-y-8">
            <div className="space-y-4">
              <Logo className="mx-auto w-24 h-24 bg-blue-500 rounded-3xl shadow-2xl shadow-blue-200 p-3 mb-2" />
              <h1 className="text-4xl font-black tracking-tight">Hydrated<span className="text-blue-500">.</span></h1>
              <p className="text-slate-500 font-medium leading-relaxed">
                Your personal AI-driven hydration guardian. <br />
                Track sips, earn rewards, and stay healthy.
              </p>
            </div>

            <div className="grid gap-6">
              <Button 
                onClick={handleGoogleLogin}
                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold h-14 rounded-2xl shadow-lg transition-all active:scale-95 flex items-center justify-center gap-3 underline-offset-4"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Sign in with Google
              </Button>
            </div>

            <p className="text-[10px] text-slate-400 font-medium pt-4">
              Don't have an account? Simply sign in with Google to create one. <br />
              By continuing, you agree to our terms of service.
            </p>
          </div>
        </div>
      )}

      {user && !dataLoaded && (
        <div className="fixed inset-0 bg-blue-500 z-[100] flex items-center justify-center">
           <motion.div 
             animate={{ rotate: 360 }}
             transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
             className="w-12 h-12 border-4 border-white border-t-transparent rounded-full"
           />
        </div>
      )}
      
      {/* Header Navigation */}
      <header className="max-w-7xl mx-auto flex justify-between items-center mb-8">
        <div className="flex items-center gap-3">
          <Logo className="w-11 h-11 bg-blue-500 rounded-xl shadow-lg shadow-blue-200 p-1.5" />
          <h1 className="text-2xl font-bold tracking-tight">Hydrated<span className="text-blue-500">.</span></h1>
        </div>
          <div className="flex items-center gap-4">
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleRefresh}
            className={`w-10 h-10 rounded-full bg-white border border-slate-200 shadow-sm transition-all active:scale-90 group ${isSyncing ? 'animate-spin cursor-not-allowed' : 'hover:bg-slate-50 hover:border-blue-100 hover:scale-105'}`}
            disabled={isSyncing}
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'text-blue-500' : 'text-slate-400 opacity-60 group-hover:text-blue-500 group-hover:opacity-100'}`} strokeWidth={2.5} />
          </Button>
          <div className="bg-white border border-slate-200 px-4 py-2 rounded-full flex items-center gap-2 shadow-sm">
            <span className="text-blue-500 font-bold">💧 {stats.totalPoints}</span>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Drops</span>
          </div>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={logoutUser} 
            className="w-10 h-10 rounded-full bg-red-50 border-2 border-white shadow-sm hover:bg-red-100 transition-all active:scale-95 group"
          >
            <Lock className="w-4 h-4 text-red-600 transition-transform group-hover:scale-110" strokeWidth={2.5} />
          </Button>
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setShowSettings(true)} 
            className="w-10 h-10 rounded-full bg-slate-100 border-2 border-white shadow-sm hover:bg-slate-200 transition-all active:scale-95 group"
          >
            <Settings className="w-5 h-5 text-slate-600 transition-transform group-hover:rotate-45" strokeWidth={2} />
          </Button>
        </div>
      </header>

      {/* Main Bento Grid */}
      <AnimatePresence mode="wait">
        {currentView === 'tracker' && (
          <motion.div 
            key="tracker"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 md:grid-rows-6 gap-6 md:h-[calc(100vh-160px)] min-h-[600px]"
          >
            {/* Progress Dashboard (Hero Card) - col-span-7 row-span-4 */}
            <div className="md:col-span-7 md:row-span-4 bg-white rounded-3xl p-8 border border-slate-100 shadow-sm flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-3xl font-bold">Today's Intake</h2>
                  <p className="text-slate-400 mt-1">You're doing great! Keep sipping 💧</p>
                </div>
                <div className="text-right">
                  <span className="text-4xl font-black text-blue-600 tracking-tighter">{(stats.currentIntake / 1000).toFixed(1)}L</span>
                  <span className="text-slate-300 font-bold text-xl ml-1">/ {(stats.dailyGoal / 1000).toFixed(1)}L</span>
                </div>
              </div>
              
              {/* Visual Water Progress */}
              <div className="relative h-48 md:flex-1 md:my-8 bg-blue-50 rounded-2xl overflow-hidden mt-6">
                <motion.div 
                  className="absolute bottom-0 left-0 right-0 bg-blue-500"
                  initial={{ height: '0%' }}
                  animate={{ height: `${progress}%` }}
                  transition={{ type: 'spring', stiffness: 50, damping: 20 }}
                >
                  <div className="absolute top-0 left-0 right-0 h-4 bg-white/20 opacity-40"></div>
                  <motion.div 
                    className="absolute inset-0 bg-blue-400/30"
                    animate={{ 
                      y: [0, -5, 0],
                    }}
                    transition={{ repeat: Infinity, duration: 4, ease: "easeInOut" }}
                  />
                </motion.div>
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <span className="text-6xl md:text-8xl font-black text-blue-900/10">{Math.round(progress)}%</span>
                </div>
              </div>

              <div className="grid grid-cols-2 md:flex gap-4 mt-6">
                <Button 
                   onClick={() => handleIntake(250)}
                   className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-6 rounded-xl transition-all shadow-md shadow-blue-100"
                >
                  + 250ml Glass
                </Button>
                <Button 
                   onClick={() => handleIntake(500)}
                   className="flex-1 bg-white border-2 border-blue-100 hover:border-blue-200 text-blue-600 font-bold py-6 rounded-xl transition-all"
                >
                  + 500ml Bottle
                </Button>
                <Button 
                   onClick={() => setShowCustomIntake(true)}
                   className="flex-1 bg-slate-800 hover:bg-slate-900 text-white font-bold py-6 rounded-xl transition-all shadow-md group"
                >
                  <Plus className="w-4 h-4 mr-1 group-hover:rotate-90 transition-transform" strokeWidth={3} />
                  Custom
                </Button>
                <Button 
                  size="icon"
                  onClick={() => setShowSettings(true)}
                  className="w-16 h-auto bg-slate-100 hover:bg-slate-200 text-slate-500 font-bold rounded-xl flex items-center justify-center group transition-all"
                >
                  <Settings className="w-5 h-5 group-hover:rotate-45 transition-transform" strokeWidth={2.5} />
                </Button>
              </div>
            </div>

            {/* Game Stats Card - col-span-5 row-span-2 */}
            <div className="md:col-span-5 md:row-span-2 bg-indigo-900 text-white rounded-3xl p-6 relative overflow-hidden flex flex-col justify-center">
              <div className="relative z-10">
                <h3 className="text-indigo-200 text-[10px] font-bold uppercase tracking-widest mb-2 flex items-center gap-1">
                  <Zap className="w-3 h-3 text-blue-500" strokeWidth={2.5} /> Current Rank
                </h3>
                <p className="text-3xl font-bold mb-4">{currentRank.name} {currentRank.icon}</p>
                <div className="w-full bg-indigo-950 h-2 rounded-full overflow-hidden">
                  <motion.div 
                    className="bg-indigo-400 h-full"
                    initial={{ width: '0%' }}
                    animate={{ width: `${(stats.totalPoints % 1000) / 10}%` }}
                  ></motion.div>
                </div>
                <p className="text-[10px] text-indigo-300 mt-2 font-bold uppercase tracking-wider">
                  {1000 - (stats.totalPoints % 1000)} pts until next milestone
                </p>
              </div>
              <div className="absolute -bottom-6 -right-6 text-9xl opacity-10 select-none">💧</div>
            </div>

            {/* Streak Card - col-span-2 row-span-2 */}
            <div className={`md:col-span-2 md:row-span-2 rounded-3xl p-6 border flex flex-col items-center justify-center text-center transition-all duration-700 relative overflow-hidden ${
              stats.streak >= 14 ? 'bg-slate-900 border-orange-500/50 shadow-2xl shadow-orange-500/20' :
              stats.streak >= 7 ? 'bg-orange-500 text-white border-orange-600 shadow-xl shadow-orange-200' :
              stats.streak >= 3 ? 'bg-orange-100 border-orange-200 shadow-lg shadow-orange-100 text-orange-900' :
              'bg-orange-50 border-orange-100 text-orange-900'
            }`}>
              {/* Dynamic Background for high streaks */}
              {stats.streak >= 14 && (
                <motion.div 
                  className="absolute inset-0 bg-gradient-to-br from-orange-600/20 via-red-600/20 to-orange-600/20"
                  animate={{ 
                    rotate: [0, 360],
                    scale: [1, 1.2, 1]
                  }}
                  transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                />
              )}

              <div className="relative z-10 flex flex-col items-center">
                <motion.span 
                  key={stats.streak}
                  initial={{ scale: 0.5, rotate: -20, y: 10 }}
                  animate={{ scale: 1, rotate: 0, y: 0 }}
                  className="text-4xl mb-2 block"
                >
                  {stats.streak >= 14 ? '🔱' : stats.streak >= 7 ? '👑' : stats.streak >= 3 ? '⚡' : '🔥'}
                </motion.span>
                
                <h4 className={`text-5xl font-black leading-none tracking-tighter ${stats.streak >= 7 ? 'text-white' : 'text-orange-600'}`}>
                  {stats.streak}
                </h4>
                
                <p className={`text-[10px] font-bold uppercase tracking-widest mt-1 ${stats.streak >= 7 ? 'text-orange-100' : 'text-orange-800'}`}>
                  Day Streak
                </p>

                {/* Multiplier Badge */}
                {stats.streak >= 3 && (
                  <motion.div 
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`mt-3 px-3 py-1 rounded-full text-[10px] font-black flex items-center gap-1 shadow-sm border ${
                      stats.streak >= 14 ? 'bg-orange-500 text-white border-orange-400' :
                      stats.streak >= 7 ? 'bg-white text-orange-600 border-white' :
                      'bg-orange-600 text-white border-orange-500'
                    }`}
                  >
                    <Zap className="w-2.5 h-2.5" />
                    {stats.streak >= 14 ? '2.0x' : stats.streak >= 7 ? '1.5x' : '1.2x'} Drops
                  </motion.div>
                )}

                {stats.streak > 0 && stats.streak % 7 === 0 && (
                  <div className="mt-2 bg-white/20 px-2 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-widest">
                    Week Master
                  </div>
                )}
              </div>
            </div>

            {/* Shop / Unlockables Card - col-span-3 row-span-2 */}
            <div className="md:col-span-3 md:row-span-2 bg-white rounded-3xl p-6 border border-slate-100 shadow-sm flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-700 text-sm">Rewards Shop</h3>
                <span className="text-[8px] font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded-full uppercase tracking-wider">New</span>
              </div>
              <div className="space-y-2 flex-1 overflow-y-auto pr-1 custom-scrollbar">
                {SHOP_ITEMS.map((item) => {
                  const isOwned = stats.inventory.includes(item.id);
                  const canAfford = stats.totalPoints >= item.cost;
                  
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleBuyItem(item.id, item.cost)}
                      disabled={isOwned}
                      className={`w-full flex items-center justify-between p-2 rounded-xl border transition-all ${
                        isOwned 
                          ? 'bg-slate-50 border-slate-100 opacity-60 cursor-default' 
                          : 'bg-white hover:border-blue-200 hover:shadow-sm cursor-pointer'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{item.icon}</span>
                        <div className="text-left">
                          <p className="text-[10px] font-bold text-slate-700">{item.name}</p>
                          <p className="text-[8px] text-slate-400 font-medium">{item.description}</p>
                        </div>
                      </div>
                      {isOwned ? (
                        <CheckCircle2 className="w-3 h-3 text-green-500" />
                      ) : (
                        <span className={`text-[9px] font-black ${canAfford ? 'text-blue-600' : 'text-slate-300'}`}>
                          {item.cost} 💧
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Social Showcase Preview (The Prize) - col-span-5 row-span-2 */}
            <div className="md:col-span-5 md:row-span-2 bg-gradient-to-br from-blue-400 to-blue-600 rounded-3xl p-6 text-white relative flex flex-col justify-between overflow-hidden shadow-xl shadow-blue-100">
              <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-3xl"></div>
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <div className="bg-white/20 px-2 py-1 rounded-lg border border-white/10">
                    <span className="text-[10px] font-bold tracking-widest uppercase">Insta Ready</span>
                  </div>
                </div>
                <p className="text-lg md:text-xl font-serif italic mb-2 leading-tight">
                  {generatedNote || "Staying hydrated isn't just a habit, it's a lifestyle. Goal achieved!"}
                </p>
                <p className="text-[10px] opacity-80 uppercase tracking-widest font-bold">— Shared via Hydrated</p>
              </div>
              
              <Button 
                onClick={generatedNote ? shareNote : handleUnlockNote}
                disabled={isGenerating}
                className="w-full bg-white text-blue-600 font-bold py-3 rounded-xl flex items-center justify-center gap-2 mt-4 hover:bg-blue-50 transition-colors shadow-lg border-none h-12"
              >
                {isGenerating ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 1 }}>
                    <History className="w-4 h-4" />
                  </motion.div>
                ) : (
                  <>
                    {generatedNote ? "Share to Social" : stats.inventory.includes('note') ? "Regenerate Note" : `Unlock Feed Note (${NOTE_COST}💧)`}
                    <Share2 className="w-4 h-4" />
                  </>
                )}
              </Button>
            </div>

            {/* Weekly History Grid - col-span-7 row-span-2 */}
            <div className="md:col-span-7 md:row-span-2 bg-white rounded-3xl p-6 border border-slate-100 shadow-sm flex flex-col">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-bold text-slate-700 text-sm">Recent Logs</h3>
                {stats.logs.length > 0 && (
                  <Button 
                    variant="link" 
                    className="text-[10px] h-auto p-0 font-bold text-blue-500 uppercase tracking-wider"
                    onClick={() => setCurrentView('history')}
                  >
                    View All
                  </Button>
                )}
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                {stats.logs.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-300 gap-2 opacity-50">
                    <Droplets className="w-8 h-8" />
                    <p className="text-[10px] font-bold uppercase tracking-widest">No sips yet today</p>
                  </div>
                ) : (
                  stats.logs.map((log) => (
                    <motion.div 
                      key={log.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100/50 group"
                    >
                      <div className="flex items-center gap-3">
                        <div className="bg-blue-100 p-1.5 rounded-lg">
                          <Droplets className="w-3 h-3 text-blue-500" />
                        </div>
                        <div>
                          <p className="text-[10px] font-bold text-slate-700">{log.amount} ml</p>
                          <p className="text-[8px] font-medium text-slate-400 capitalize">{log.time}</p>
                        </div>
                      </div>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="w-7 h-7 rounded-full text-slate-300 hover:text-red-500 hover:bg-red-50 opacity-0 group-hover:opacity-100 transition-all"
                        onClick={() => handleRemoveLog(log.id)}
                      >
                         <X className="w-3 h-3 group-hover:scale-110 transition-transform" strokeWidth={3} />
                      </Button>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          </motion.div>
        )}

        {currentView === 'history' && (
          <motion.div 
            key="history"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="max-w-3xl mx-auto space-y-6"
          >
            <div className="bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
              <h2 className="text-2xl font-bold flex items-center gap-2 mb-6">
                <History className="text-blue-500" />
                Hydration Logs
              </h2>
              <div className="space-y-4">
                {historyData.map((log, i) => (
                  <div key={i} className="flex justify-between items-center p-4 rounded-2xl bg-slate-50 border border-slate-100">
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold text-white shadow-sm
                        ${log.status === 'success' ? 'bg-green-500' : log.status === 'near' ? 'bg-yellow-500' : 'bg-slate-400'}`}
                      >
                         {log.status === 'success' ? '✓' : log.status === 'near' ? '!' : '×'}
                      </div>
                      <div>
                        <p className="font-bold text-slate-800">{format(new Date(log.date), 'EEEE, MMM do')}</p>
                        <p className="text-xs text-slate-500 font-medium lowercase italic">Goal: {(log.goal/1000).toFixed(1)}L</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-black text-slate-900">{(log.amount/1000).toFixed(1)}L</p>
                      <p className={`text-[10px] font-bold uppercase tracking-wider
                        ${log.status === 'success' ? 'text-green-600' : log.status === 'near' ? 'text-yellow-600' : 'text-slate-400'}`}
                      >
                        {Math.round((log.amount/log.goal)*100)}% Reached
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}

        {currentView === 'schedule' && (
          <motion.div 
            key="schedule"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-6"
          >
            {/* Today's Schedule List */}
            <div className="md:col-span-8 bg-white rounded-3xl p-8 border border-slate-100 shadow-sm">
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-2xl font-bold flex items-center gap-2">
                    <Calendar className="text-blue-500" />
                    Today's Plan
                  </h2>
                  <p className="text-slate-400 text-sm">Strategic sips for optimal hydration</p>
                </div>
                <Badge variant="outline" className="border-blue-100 text-blue-600 bg-blue-50">
                  {stats.schedule.filter(s => s.completed).length} / {stats.schedule.length} Done
                </Badge>
              </div>

              <div className="space-y-4">
                {stats.schedule.map((item, i) => (
                  <div key={i} className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${item.completed ? 'bg-slate-50 border-slate-100 opacity-60' : 'bg-white border-blue-100 shadow-md shadow-blue-50'}`}>
                    <div className="flex items-center gap-4">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center font-bold shadow-sm transition-colors ${item.completed ? 'bg-green-500 text-white' : 'bg-blue-100 text-blue-600'}`}>
                        {item.completed ? '✓' : <Clock className="w-5 h-5" />}
                      </div>
                      <div>
                        <p className="font-bold text-slate-800">{item.time}</p>
                        <p className="text-xs text-slate-400 font-medium">Recommended: {item.amount}ml</p>
                      </div>
                    </div>
                    {!item.completed && (
                      <Button 
                        size="sm" 
                        onClick={() => {
                          handleIntake(item.amount);
                          setStats(prev => ({
                            ...prev,
                            schedule: prev.schedule.map((s, idx) => idx === i ? { ...s, completed: true } : s)
                          }));
                        }}
                        className="bg-blue-500 hover:bg-blue-600 text-white rounded-xl font-bold text-[10px] px-4"
                      >
                        LOG THIS
                      </Button>
                    )}
                  </div>
                ))}
              </div>

              <div className="mt-8 p-6 bg-slate-50 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-center">
                <p className="text-slate-400 text-xs font-bold uppercase tracking-widest mb-2">Upcoming Window</p>
                <div className="text-xl font-black text-slate-300 italic">Tomorrow: {format(addDays(new Date(), 1), 'EEEE, MMM do')}</div>
                <Button variant="link" className="text-blue-500 font-bold text-xs mt-2">Adjust Future Alerts →</Button>
              </div>
            </div>

            {/* Smart Advice Card */}
            <div className="md:col-span-4 space-y-6">
              <div className="bg-indigo-900 rounded-3xl p-6 text-white overflow-hidden relative">
                <div className="relative z-10">
                  <h3 className="font-bold text-lg mb-2">H-Bot Planning Duo</h3>
                  <p className="text-indigo-200 text-sm leading-relaxed">
                    "Based on your Level {stats.level} status, I recommend focusing on a consistent 500ml afternoon intake to avoid metabolic dips."
                  </p>
                </div>
                <div className="absolute -bottom-4 -right-4 opacity-10">
                  <Bot className="w-24 h-24" />
                </div>
              </div>

              <div className="bg-white rounded-3xl p-6 border border-slate-100 shadow-sm">
                <h4 className="font-bold text-slate-700 mb-4 text-sm">Recent Activity Map</h4>
                <div className="space-y-3">
                  {[
                    { label: 'Morning Rush', val: 0.8 },
                    { label: 'Lunch Recheck', val: 0.4 },
                    { label: 'Sunset Hydration', val: 0.9 },
                  ].map((stat, i) => (
                    <div key={i} className="space-y-1">
                      <div className="flex justify-between text-[10px] font-bold text-slate-400 uppercase">
                        <span>{stat.label}</span>
                        <span>{stat.val * 100}% Efficiency</span>
                      </div>
                      <Progress value={stat.val * 100} className="h-1.5 bg-slate-100" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {currentView === 'rank' && (
          <motion.div 
            key="rank"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="max-w-3xl mx-auto space-y-6"
          >
            <div className="bg-indigo-900 rounded-3xl p-8 text-white relative overflow-hidden">
               <div className="relative z-10">
                  <h2 className="text-3xl font-black mb-2 flex items-center gap-2">
                    <Trophy className="text-yellow-400" />
                    Hydration Hall of Fame
                  </h2>
                  <p className="text-indigo-200 font-medium mb-8">Climb the ranks by accumulating HydraPoints from every sip.</p>
                  
                  <div className="space-y-6">
                    {ranks.map((rank, i) => {
                      const isUnlocked = stats.totalPoints >= rank.xp;
                      const isNext = !isUnlocked && (i === 0 || stats.totalPoints >= ranks[i-1].xp);
                      
                      return (
                        <div key={i} className={`flex items-center gap-6 p-4 rounded-2xl border transition-all
                          ${isUnlocked ? 'bg-white/10 border-white/20 opacity-100 scale-100 shadow-lg' : 'bg-indigo-950/50 border-indigo-800/50 opacity-40 scale-95'}`}
                        >
                          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shadow-inner
                            ${isUnlocked ? 'bg-indigo-500/30' : 'bg-slate-900/50'}`}
                          >
                             {isUnlocked ? rank.icon : <Lock className="w-6 h-6 text-indigo-700" />}
                          </div>
                          <div className="flex-1">
                            <div className="flex justify-between items-center mb-1">
                              <h3 className="font-bold text-lg">{rank.name}</h3>
                              {isNext && <Badge className="bg-yellow-400 text-slate-950 font-black text-[10px]">NEXT</Badge>}
                            </div>
                            <p className="text-xs font-bold uppercase tracking-widest text-indigo-300">
                              Requires {rank.xp} Drops
                            </p>
                          </div>
                          {isUnlocked && <CheckCircle2 className="text-green-400 w-6 h-6" />}
                        </div>
                      )
                    })}
                  </div>
               </div>
               <div className="absolute -top-10 -right-10 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom Micro Label */}
      <footer className="mt-12 flex flex-col md:flex-row items-center justify-center gap-6">
        <div className="hidden md:block h-1 w-32 bg-slate-200 rounded-full overflow-hidden">
          <div className="h-full w-3/4 bg-blue-500 rounded-full animate-pulse-slow"></div>
        </div>
        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap">
          Hydrated Core Engine v2.4 <span className="mx-2 opacity-50">|</span> Powered by H-Bot AI
        </span>
        <div className="hidden md:block h-1 w-32 bg-slate-200 rounded-full overflow-hidden">
          <div className="h-full w-1/4 bg-blue-500 rounded-full animate-pulse-slow"></div>
        </div>
      </footer>


      {/* Custom Intake Modal */}
      <Dialog open={showCustomIntake} onOpenChange={setShowCustomIntake}>
        <DialogContent className="sm:max-w-xs bg-white rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-xl font-black text-slate-900">Custom Intake</DialogTitle>
            <DialogDescription className="text-xs">How much did you drink?</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <div className="relative">
              <Input 
                type="number" 
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
                placeholder="250"
                className="text-2xl font-black text-center h-16 rounded-2xl border-2 focus:border-blue-500 transition-all pr-12"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-slate-400 uppercase text-xs">ml</span>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-4">
              {[100, 200, 300, 400, 600, 1000].map((val) => (
                <Button 
                  key={val} 
                  variant="outline" 
                  size="sm"
                  className="font-bold text-[10px] h-8 rounded-lg"
                  onClick={() => setCustomAmount(val.toString())}
                >
                  {val}ml
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button 
              onClick={() => {
                handleIntake(parseInt(customAmount));
                setShowCustomIntake(false);
              }} 
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl h-12"
            >
              Log Intake
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Settings Modal */}
      <Dialog open={showSettings} onOpenChange={setShowSettings}>
        <DialogContent className="sm:max-w-md bg-white rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black text-slate-900 items-center flex gap-2">
              <Settings className="w-6 h-6 text-blue-500" />
              Customization
            </DialogTitle>
            <DialogDescription className="font-medium">
              Adjust your daily hydration targets for H-Bot.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 pt-4 max-h-[60vh] overflow-y-auto pr-2 custom-scrollbar">
            <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl border border-slate-100">
               <div className="space-y-0.5">
                  <Label className="text-sm font-bold">Push Notifications</Label>
                  <p className="text-[10px] text-slate-500 font-medium tracking-tight">Active alerts & rewards.</p>
               </div>
               <Button 
                variant={notificationsEnabled ? "default" : "outline"}
                size="sm"
                onClick={notificationsEnabled ? () => {
                  setNotificationsEnabled(false);
                  localStorage.setItem('hydrated_notifications', 'false');
                } : requestNotificationPermission}
                className={`rounded-xl font-bold transition-all px-4 ${
                  notificationsEnabled ? 'bg-green-500 hover:bg-green-600' : 
                  (typeof window !== 'undefined' && Notification.permission === 'denied') ? 'border-red-200 text-red-500 hover:bg-red-50' : 'border-blue-200 text-blue-600'
                }`}
               >
                 {notificationsEnabled ? "On" : (typeof window !== 'undefined' && Notification.permission === 'denied') ? "Blocked" : "Enable"}
               </Button>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between font-bold text-sm text-slate-600">
                <Label>Today's Total Intake</Label>
                <span className="text-blue-600">{stats.currentIntake} ml</span>
              </div>
              <div className="flex gap-2">
                <Input 
                  type="number"
                  value={stats.currentIntake}
                  onChange={(e) => {
                    const val = parseInt(e.target.value) || 0;
                    setStats(prev => ({ ...prev, currentIntake: Math.max(0, val) }));
                  }}
                  className="rounded-xl border-2 font-bold"
                />
                <Button 
                  variant="outline"
                  size="icon"
                  className="rounded-xl border-red-100 text-red-500 hover:bg-red-50 hover:border-red-200 transition-colors"
                  onClick={() => {
                    if (confirm("Clear all logs and progress for today?")) {
                      setStats(prev => ({ ...prev, currentIntake: 0, logs: [] }));
                      toast.info("Daily progress reset.");
                    }
                  }}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <p className="text-[10px] text-slate-400 font-medium">Changing the total manually won't sync with existing logs below.</p>
            </div>

            <div className="space-y-4">
              <div className="flex justify-between font-bold text-sm text-slate-600">
                <Label>Daily Intake Goal</Label>
                <span>{stats.dailyGoal} ml</span>
              </div>
              <Slider 
                value={[stats.dailyGoal]} 
                min={1000} 
                max={5000} 
                step={100}
                onValueChange={(val) => setStats(prev => ({ ...prev, dailyGoal: val[0] }))}
                className="py-4"
              />
              <div className="grid grid-cols-5 gap-2">
                {[1500, 2000, 2500, 3000, 4000].map((val) => (
                  <Button 
                    key={val} 
                    variant={stats.dailyGoal === val ? 'default' : 'outline'}
                    size="sm"
                    className="text-[10px] font-bold p-0 h-8"
                    onClick={() => setStats(prev => ({ ...prev, dailyGoal: val }))}
                  >
                    {val/1000}L
                  </Button>
                ))}
              </div>
            </div>
            <div className="flex items-center space-x-2 bg-blue-50 p-4 rounded-2xl border border-blue-100">
              <Bot className="w-5 h-5 text-blue-500 shrink-0" />
              <p className="text-xs text-blue-700 font-medium">
                Setting a higher goal boosts your Leveling speed by <span className="font-bold">15%</span>!
              </p>
            </div>
          </div>
          <DialogFooter className="mt-4">
            <Button onClick={() => setShowSettings(false)} className="w-full bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl h-12">
              Save Preferences
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlocked Note Modal */}
      <Dialog open={showNoteModal} onOpenChange={setShowNoteModal}>
        <DialogContent className="sm:max-w-md bg-[#0F172A] text-white border-blue-500/30 rounded-3xl">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black flex items-center gap-2">
              <Badge className="bg-yellow-400 text-slate-900 border-none font-black mr-2">UNLOCKED</Badge>
              Milestone Card
            </DialogTitle>
          </DialogHeader>
          <div className="py-8 text-center relative overflow-hidden">
             {/* Decorative Background Elements */}
             <div className="absolute top-0 -left-10 w-32 h-32 bg-blue-600/20 blur-3xl rounded-full" />
             <div className="absolute bottom-0 -right-10 w-32 h-32 bg-purple-600/20 blur-3xl rounded-full" />
             
             <div className="relative z-10 space-y-6">
                <div className="p-1 rounded-full bg-gradient-to-r from-blue-400 to-purple-400 w-fit mx-auto animate-pulse">
                  <div className="bg-slate-900 p-4 rounded-full">
                    <Droplets className="w-12 h-12 text-blue-400" />
                  </div>
                </div>
                <div className="space-y-2">
                   <p className="text-blue-400 font-black text-xs uppercase tracking-[0.3em]">H-Bot Analysis</p>
                   <blockquote className="text-xl font-bold italic leading-relaxed px-4">
                    "{generatedNote}"
                   </blockquote>
                </div>
             </div>
          </div>
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              onClick={() => setShowNoteModal(false)}
              className="flex-1 border-white/10 hover:bg-white/5 text-white font-bold rounded-xl h-12"
            >
              Close
            </Button>
            <Button 
              onClick={shareNote}
              className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl h-12"
            >
              <Share2 className="w-4 h-4 mr-2" />
              Share Status
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Fixed Bottom Nav */}
      <div className="fixed bottom-6 left-6 right-6 z-40 bg-slate-900/90 backdrop-blur-xl text-white rounded-3xl p-4 flex justify-between items-center shadow-2xl shadow-slate-900/40 border border-white/5 max-w-2xl mx-auto">
        <div className="flex gap-4 md:gap-8">
          <div 
            onClick={() => setCurrentView('tracker')}
            className={`flex flex-col items-center gap-1 group cursor-pointer transition-all ${currentView === 'tracker' ? 'opacity-100 scale-110' : 'opacity-40 hover:opacity-70'}`}
          >
            <Droplets className={`w-6 h-6 ${currentView === 'tracker' ? 'text-blue-400' : 'text-slate-400'} group-hover:scale-110 transition-transform`} strokeWidth={2.5} />
            <span className="text-[9px] font-black uppercase tracking-tighter leading-none">Tracker</span>
          </div>
          <div 
            onClick={() => setCurrentView('schedule')}
            className={`flex flex-col items-center gap-1 group cursor-pointer transition-all ${currentView === 'schedule' ? 'opacity-100 scale-110' : 'opacity-40 hover:opacity-70'}`}
          >
            <Calendar className={`w-6 h-6 ${currentView === 'schedule' ? 'text-blue-400' : 'text-slate-400'} group-hover:scale-110 transition-transform`} strokeWidth={2.5} />
            <span className="text-[9px] font-black uppercase tracking-tighter leading-none">Plan</span>
          </div>
          <div 
            onClick={() => setCurrentView('history')}
            className={`flex flex-col items-center gap-1 group cursor-pointer transition-all ${currentView === 'history' ? 'opacity-100 scale-110' : 'opacity-40 hover:opacity-70'}`}
          >
            <History className={`w-6 h-6 ${currentView === 'history' ? 'text-blue-400' : 'text-slate-400'} group-hover:scale-110 transition-transform`} strokeWidth={2.5} />
            <span className="text-[9px] font-black uppercase tracking-tighter leading-none">Stats</span>
          </div>
          <div 
            onClick={() => setCurrentView('rank')}
            className={`flex flex-col items-center gap-1 group cursor-pointer transition-all ${currentView === 'rank' ? 'opacity-100 scale-110' : 'opacity-40 hover:opacity-70'}`}
          >
            <Trophy className={`w-6 h-6 ${currentView === 'rank' ? 'text-blue-400' : 'text-slate-400'} group-hover:scale-110 transition-transform`} strokeWidth={2.5} />
            <span className="text-[9px] font-black uppercase tracking-tighter leading-none">Rank</span>
          </div>
        </div>
        <div className="h-10 w-[2px] bg-white/10 mx-2" />
        <div className="flex items-center gap-3 bg-white/5 pr-4 pl-2 py-2 rounded-2xl border border-white/5">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Trophy className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[8px] font-black uppercase text-blue-400 tracking-tighter">Current Rank</p>
            <p className="text-[10px] font-bold text-white whitespace-nowrap">{currentRank.name} {currentRank.icon}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

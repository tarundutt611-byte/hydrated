import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, RecaptchaVerifier, signInWithPhoneNumber } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth();
auth.useDeviceLanguage(); // Use browser language for ReCaptcha

export const googleProvider = new GoogleAuthProvider();

export { RecaptchaVerifier, signInWithPhoneNumber };

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    // Try to get a document from a test path or any path to check connection
    // We use a timeout to avoid hanging if the network is really blocked or project invalid
    const docRef = doc(db, 'test', 'connection');
    await getDocFromServer(docRef);
    console.log("Firebase connection successful.");
  } catch (error: any) {
    console.error("Firebase connection test failed:", error);
    
    if (error.code === 'permission-denied') {
      console.log("Firestore connection confirmed (Permission Denied is expected if rules are locked).");
      return;
    }

    if (error.code === 'unavailable' || error.message?.includes('offline')) {
      console.error("CRITICAL: Firestore is unreachable. Most likely, the database has not been created yet.");
      console.error("Please go to Firebase Console > Firestore Database and click 'Create Database'.");
      console.error("Ensure the Project ID matches: " + firebaseConfig.projectId);
    }
  }
}
testConnection();

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logout = () => signOut(auth);

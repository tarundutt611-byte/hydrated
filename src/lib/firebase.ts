import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth();
auth.useDeviceLanguage(); // Use browser language for Google login prompts if needed

export const googleProvider = new GoogleAuthProvider();

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

async function testConnection(isRetry = false) {
  try {
    const docRef = doc(db, 'test', 'connection');
    await getDocFromServer(docRef);
    console.log("Firebase connection successful.");
  } catch (error: any) {
    if (error.code === 'permission-denied') {
      console.log("Firestore connection confirmed (Permission Denied is expected if rules are locked).");
      return;
    }

    if (error.code === 'unavailable' || error.message?.includes('offline')) {
      if (!isRetry) {
        console.log("Firestore connection pending... retrying in 5s");
        setTimeout(() => testConnection(true), 5000);
        return;
      }
      console.warn("Firestore status: OFFLINE or NOT PROVISIONED.");
      console.info("TIP: If you haven't created your Firestore database yet, go to Firebase Console > Firestore Database and click 'Create Database'.");
      console.info("Project ID: " + firebaseConfig.projectId);
      return;
    }
    
    console.error("Firebase connection test failed:", error);
  }
}
testConnection();

export const signInWithGoogle = () => signInWithPopup(auth, googleProvider);
export const logout = () => signOut(auth);

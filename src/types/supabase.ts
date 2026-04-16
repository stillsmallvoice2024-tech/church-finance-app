export type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          full_name: string
          role: string
          avatar_url: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id: string
          full_name?: string
          role?: string
          avatar_url?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          full_name?: string
          role?: string
          avatar_url?: string | null
          updated_at?: string
        }
      }
      transactions: {
        Row: {
          id: string
          date: string
          description: string
          amount: number
          currency: string
          category: string
          account_id: string
          type: string
          reference: string | null
          notes: string | null
          created_by: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          date: string
          description: string
          amount: number
          currency?: string
          category: string
          account_id: string
          type: string
          reference?: string | null
          notes?: string | null
          created_by: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          date?: string
          description?: string
          amount?: number
          currency?: string
          category?: string
          account_id?: string
          reference?: string | null
          notes?: string | null
          updated_at?: string
        }
      }
      accounts: {
        Row: {
          id: string
          name: string
          type: string
          balance: number
          currency: string
          description: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          type: string
          balance?: number
          currency?: string
          description?: string | null
          created_at?: string
        }
        Update: {
          name?: string
          type?: string
          balance?: number
          currency?: string
          description?: string | null
        }
      }
    }
  }
}

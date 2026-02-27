import { Component, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { POSBridgeService } from './pos-bridge.service';

interface SalesItem {
  id?: string;
  description?: string;
  quantity?: number;
  quantityTypeCodeName?: string;
  unitGrossAmount: number;
  taxRate: number;
  grossAmount: number;
}

interface Receipt {
  id?: string;
  businessTransactionDate: string;
  currency?: string;
  salesItems: SalesItem[];
  totalNetAmount: number;
  totalTaxAmount: number;
  totalGrossAmount: number;
}

@Component({
  selector: 'app-root',
  imports: [CommonModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  connected = signal(false);
  receipt = signal<Receipt | null>(null);
  logs = signal<string[]>([]);

  private sub?: Subscription;

  constructor(private pos: POSBridgeService) {}

  ngOnInit(): void {
    this.pos.ready$.subscribe(() => {
      this.connected.set(true);
      this.log('Bridge ready');
    });

    this.sub = this.pos.on('receiptChanged').subscribe((receipt: Receipt) => {
      this.log('Receipt changed event received');
      console.log('receipt', receipt);
      this.receipt.set(receipt);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  sendMessage(): void {
    this.pos.pushEvent('SHOW_MESSAGE', 'Hello from the iframe app!');
    this.log('Sent SHOW_MESSAGE');
  }

  addSalesItem(): void {
    this.pos.pushEvent('SALESITEM_ADD', {
      materialId: 'JAC.49000',
      quantity: 1,
      split: true,
    });
    this.log('Sent SALESITEM_ADD');
  }

  async fetchReceipt(): Promise<void> {
    try {
      this.log('Fetching receipt...');
      const receipt = await this.pos.getReceipt();
      this.log('Receipt received');
      this.receipt.set(receipt);
    } catch (e: any) {
      this.log(`Error: ${e.message}`);
    }
  }

  formatCurrency(amount: number, currency?: string): string {
    return new Intl.NumberFormat('de-DE', {
      style: 'currency',
      currency: currency || 'EUR',
    }).format(amount);
  }

  private log(text: string): void {
    console.log('Logging', text);
    const time = new Date().toLocaleTimeString();
    this.logs.update((logs) => [...logs, `[${time}] ${text}`]);
  }
}

import { Component, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { POSBridgeService } from '../pos-bridge.service';
import {Receipt, SalesItem} from '../shared/receipt.model';

@Component({
  selector: 'app-embedded',
  imports: [CommonModule],
  templateUrl: './embedded.html',
  styleUrl: './embedded.css',
})
export class EmbeddedComponent implements OnInit, OnDestroy {
  connected = signal(false);
  totalGrossAmount = signal<number | null>(null);
  selectedItem = signal<SalesItem | null>(null);
  currency = signal<string>('EUR');

  private sub?: Subscription;
  private sub2?: Subscription;

  constructor(private pos: POSBridgeService) {}

  ngOnInit(): void {
    this.pos.ready$.subscribe(() => {
      this.connected.set(true);
    });

    this.sub = this.pos.on('receiptChanged').subscribe((receipt: Receipt) => {
      this.totalGrossAmount.set(receipt.paymentGrossAmount);
      if (receipt.currency) {
        this.currency.set(receipt.currency);
      }
    });

    this.sub2 = this.pos.on('selectedItem').subscribe((salesItem: SalesItem) => {
      console.log('salesItem', salesItem);
      this.selectedItem.set(salesItem);
    });
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.sub2?.unsubscribe();
  }

  sendMessage(): void {
    this.pos.pushEvent('SHOW_MESSAGE', 'Hello from the iframe app!');
  }

  openPopup(): void {
    this.pos.pushEvent('SB_SHOW_WEBVIEW', {});
  }

  formatCurrency(amount: number): string {
    return new Intl.NumberFormat(this.pos.locale(), {
      style: 'currency',
      currency: this.currency(),
    }).format(amount);
  }
}

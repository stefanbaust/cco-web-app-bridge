import { Component, signal, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Subscription } from 'rxjs';
import { POSBridgeService } from '../pos-bridge.service';
import { Receipt } from '../shared/receipt.model';

@Component({
  selector: 'app-popup',
  imports: [CommonModule],
  templateUrl: './popup.html',
  styleUrl: './popup.css',
})
export class PopupComponent implements OnInit, OnDestroy {
  connected = signal(false);
  receipt = signal<Receipt | null>(null);
  logs = signal<string[]>([]);

  temperature = signal<number | null>(null);
  weatherDescription = signal<string>('');
  windSpeed = signal<number | null>(null);

  private sub?: Subscription;

  private static readonly WMO_DESCRIPTIONS: Record<number, string> = {
    0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
    45: 'Fog', 48: 'Rime fog',
    51: 'Light drizzle', 53: 'Moderate drizzle', 55: 'Dense drizzle',
    61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain',
    71: 'Slight snow', 73: 'Moderate snow', 75: 'Heavy snow',
    80: 'Slight showers', 81: 'Moderate showers', 82: 'Violent showers',
    95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with heavy hail',
  };

  constructor(protected pos: POSBridgeService, private http: HttpClient) {}

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

    this.fetchWeather();
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

  toggleKeyboard(): void {
    this.pos.pushEvent('TOGGLE_KEYBOARD', {
      active: false,
    });
    this.log('Sent TOGGLE_KEYBOARD');
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
    return new Intl.NumberFormat(this.pos.locale(), {
      style: 'currency',
      currency: currency || 'EUR',
    }).format(amount);
  }

  private fetchWeather(): void {
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m,weather_code,wind_speed_10m';
    this.http.get<any>(url).subscribe({
      next: (data) => {
        const current = data.current;
        this.temperature.set(current.temperature_2m);
        this.windSpeed.set(current.wind_speed_10m);
        const code: number = current.weather_code;
        this.weatherDescription.set(
          PopupComponent.WMO_DESCRIPTIONS[code] ?? `Code ${code}`
        );
      },
      error: (err) => {
        console.error('Weather fetch failed', err);
      },
    });
  }

  private log(text: string): void {
    console.log('Logging', text);
    const time = new Date().toLocaleTimeString();
    this.logs.update((logs) => [...logs, `[${time}] ${text}`]);
  }
}

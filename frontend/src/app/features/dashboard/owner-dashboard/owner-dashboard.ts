import { Component } from '@angular/core';
import { NgStyle } from '@angular/common';
import { ChartPoint, PerformanceChart } from '../../../shared/performance-chart/performance-chart';

/**
 * Owner dashboard — the first screen of FARMIS.
 *
 * All figures are static mock data mirroring the UI inspo; they will
 * be replaced by API responses when the backend is attached.
 */
@Component({
  selector: 'app-owner-dashboard',
  imports: [PerformanceChart, NgStyle],
  templateUrl: './owner-dashboard.html',
})
export class OwnerDashboard {
  /**
   * Promo card photo, injected inline so the relative URL resolves
   * against the document base href (domain root and /farmis/ both work).
   * Falls back to the CSS gradient when the file is not uploaded yet.
   */
  readonly promoImage = 'url(images/promo-farm.jpg)';

  readonly stats = [
    { icon: 'fa-solid fa-cow', value: '120', label: 'Total Livestock', trend: '5%', tone: 'green' },
    { icon: 'fa-solid fa-kiwi-bird', value: '2,500', label: 'Poultry', trend: '8%', tone: 'blue' },
    { icon: 'fa-solid fa-leaf', value: '5 ha', label: 'Active Crops', trend: '0%', tone: 'amber' },
    { icon: 'fa-solid fa-users', value: '25', label: 'Employees', trend: '0%', tone: 'purple' },
  ];

  readonly series: ChartPoint[] = [
    { label: 'Jul', crops: 1450, livestock: 1150 },
    { label: 'Aug', crops: 2100, livestock: 1750 },
    { label: 'Sep', crops: 1950, livestock: 2350 },
    { label: 'Oct', crops: 2300, livestock: 2550 },
    { label: 'Nov', crops: 2480, livestock: 2880 },
  ];

  readonly alerts = [
    {
      icon: 'fa-solid fa-triangle-exclamation',
      title: 'Poultry Feed Low',
      text: 'Only 10 bags left',
      time: '2h ago',
      tone: 'warn',
    },
    {
      icon: 'fa-solid fa-circle-info',
      title: 'Medicine (Birds)',
      text: 'Low stock: 5 bottles',
      time: '3h ago',
      tone: 'info',
    },
    {
      icon: 'fa-solid fa-circle-check',
      title: 'Seeds (Maize)',
      text: 'In stock: 50 kg',
      time: '1d ago',
      tone: 'ok',
    },
  ];

  readonly sales = [
    { date: 'Nov 8, 2026', customer: 'Agro Mart', item: 'Maize (1 Ton)', amount: 'UGX 1,200,000' },
    { date: 'Nov 7, 2026', customer: 'Kato Farmers', item: 'Eggs (tray)', amount: 'UGX 180,000' },
    { date: 'Nov 6, 2026', customer: 'Green Farm Ltd', item: 'Organic Fertilizer', amount: 'UGX 250,000' },
  ];

  readonly activities = [
    { day: '10', month: 'Nov', title: 'Feed poultry', sub: 'Poultry House A', chip: 'Today', chipTone: 'today' },
    { day: '11', month: 'Nov', title: 'Weed maize field', sub: 'Field B', chip: 'Tomorrow', chipTone: 'tomorrow' },
    { day: '12', month: 'Nov', title: 'Check cows', sub: 'Dairy Unit', chip: 'Wed', chipTone: 'neutral' },
  ];

  readonly quickActions = [
    { icon: 'fa-solid fa-seedling', label: 'Add Crop' },
    { icon: 'fa-solid fa-cow', label: 'Add Animal' },
    { icon: 'fa-solid fa-cart-shopping', label: 'Record Sale' },
    { icon: 'fa-solid fa-wallet', label: 'Add Expense' },
  ];

  readonly recent = [
    { icon: 'fa-solid fa-seedling', title: 'Planting maize field', time: 'Today, 8:00 AM', tone: 'green' },
    { icon: 'fa-solid fa-syringe', title: 'Vaccinate poultry', time: 'Today, 10:00 AM', tone: 'blue' },
    { icon: 'fa-solid fa-screwdriver-wrench', title: 'Service tractor', time: 'Today, 2:00 PM', tone: 'amber' },
  ];
}

import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Brand } from '../../shared/brand/brand';

/** Shell around the sign-in / sign-up screens. */
@Component({
  selector: 'app-auth-layout',
  imports: [RouterOutlet, Brand],
  templateUrl: './auth-layout.html',
})
export class AuthLayout {}

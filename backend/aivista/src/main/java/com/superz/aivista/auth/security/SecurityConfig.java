package com.superz.aivista.auth.security;

import com.superz.aivista.auth.token.JwtService;
import com.superz.aivista.generation.service.GenerationConsentService;
import jakarta.servlet.DispatcherType;
import org.springframework.http.HttpMethod;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/** Configures stateless Bearer Token authentication for the Web API. */
@Configuration
@EnableWebSecurity
public class SecurityConfig {

    @Bean
    public SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            JwtService jwtService,
            RestAuthenticationFailureHandler authenticationFailureHandler,
            RestAccessDeniedHandler accessDeniedHandler,
            GenerationConsentService consentService,
            tools.jackson.databind.json.JsonMapper jsonMapper) throws Exception {
        AccessTokenAuthenticationFilter accessTokenFilter =
                new AccessTokenAuthenticationFilter(jwtService, authenticationFailureHandler);
        UserAgreementAccessFilter userAgreementAccessFilter =
                new UserAgreementAccessFilter(consentService, jsonMapper);

        return http
                .csrf(AbstractHttpConfigurer::disable)
                .formLogin(AbstractHttpConfigurer::disable)
                .httpBasic(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .requestCache(AbstractHttpConfigurer::disable)
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .exceptionHandling(exceptionHandling -> exceptionHandling
                        .authenticationEntryPoint(authenticationFailureHandler)
                        .accessDeniedHandler(accessDeniedHandler))
                .authorizeHttpRequests(authorize -> authorize
                        .dispatcherTypeMatchers(DispatcherType.ASYNC, DispatcherType.ERROR)
                        .permitAll()
                        .requestMatchers(
                                "/health",
                                "/policies/user-agreement",
                                "/auth/register",
                                "/auth/login",
                                "/auth/refresh",
                                "/auth/logout",
                                "/internal/agent-runtime",
                                "/internal/generation-worker/**",
                                "/doc.html",
                                "/swagger-ui.html",
                                "/swagger-ui/**",
                                "/v3/api-docs/**",
                                "/webjars/**",
                                "/swagger-resources/**")
                        .permitAll()
                        .requestMatchers(HttpMethod.GET, "/inspirations/following")
                        .authenticated()
                        .requestMatchers(HttpMethod.GET, "/inspirations", "/inspirations/*")
                        .permitAll()
                        .requestMatchers(HttpMethod.GET, "/users/*", "/users/*/publications",
                                "/users/*/liked-publications")
                        .permitAll()
                        .anyRequest().authenticated())
                .addFilterBefore(accessTokenFilter, UsernamePasswordAuthenticationFilter.class)
                .addFilterAfter(userAgreementAccessFilter, AccessTokenAuthenticationFilter.class)
                .build();
    }
}

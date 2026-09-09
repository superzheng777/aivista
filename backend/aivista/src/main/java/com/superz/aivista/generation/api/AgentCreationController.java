package com.superz.aivista.generation.api;

import com.superz.aivista.common.exception.BusinessException;
import com.superz.aivista.common.exception.ErrorCode;
import com.superz.aivista.common.response.ApiResponse;
import com.superz.aivista.common.response.ResponseUtils;
import com.superz.aivista.generation.dto.CreateAgentCreationRequest;
import com.superz.aivista.generation.dto.CreateAgentCreationResponse;
import com.superz.aivista.generation.service.AgentCreationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;

/** 浏览器创建 Agent 模式创作轮次的唯一入口。 */
@Tag(name = "Agent 创作")
@SecurityRequirement(name = "bearerAuth")
@RestController
@ConditionalOnProperty(prefix = "app.agent", name = "enabled", havingValue = "true")
@RequestMapping("/agent-creations")
public class AgentCreationController {
    private final AgentCreationService service;

    public AgentCreationController(AgentCreationService service) {
        this.service = service;
    }

    @Operation(summary = "创建 Agent 创作轮次")
    @PostMapping
    public ResponseEntity<ApiResponse<CreateAgentCreationResponse>> create(Authentication authentication,
            @RequestHeader("Idempotency-Key") String idempotencyKey,
            @RequestBody CreateAgentCreationRequest request) {
        var response = service.create(currentUserId(authentication), idempotencyKey, request);
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(ResponseUtils.success(response));
    }

    private static long currentUserId(Authentication authentication) {
        if (authentication == null || !(authentication.getPrincipal() instanceof Number userId)) {
            throw new BusinessException(ErrorCode.UNAUTHORIZED);
        }
        return userId.longValue();
    }
}

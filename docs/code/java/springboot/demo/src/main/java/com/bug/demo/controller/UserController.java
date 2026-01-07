package com.bug.demo.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/users")
public class UserController {

  // @PostMapping("createUser")
  @GetMapping("createUser")
  public ResponseEntity<String> createUser(String request) {
    // 这里可以添加业务逻辑，比如保存用户到数据库等
    // 假设保存成功，返回成功的响应
    return ResponseEntity.ok("User created successfully");
  }
}
